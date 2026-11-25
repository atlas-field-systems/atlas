"""Bridge Atlas frames to one Meshtastic radio over its serial API."""

from base64 import b64decode, b64encode
from contextlib import suppress
from importlib.metadata import PackageNotFoundError, version
import json
import logging
from os import devnull
import sys
from threading import Condition, Event, Lock
from time import monotonic, sleep

MAX_BODY_BYTES = 180
MAX_SERIAL_FRAME_BYTES = 256
# The stock W12 bench validated a burst of three queued application packets.
MAX_QUEUED_PACKETS = 3
CLIENT_VERSION = "2.7.11"
PROTOCOL_OUTPUT = sys.stdout
OUTPUT_LOCK = Lock()


def emit(message_type, **fields):
    with OUTPUT_LOCK:
        print(json.dumps({"type": message_type, **fields}), file=PROTOCOL_OUTPUT, flush=True)


def cached_key(node):
    try:
        key = b64decode(node["user"]["publicKey"], validate=True)
    except (KeyError, TypeError, ValueError):
        return None
    if len(key) == 32 and any(key):
        return key
    return None


def main(port, discovery_channel):
    # The upstream client owns the serial handshake and receive thread. Its logs can
    # include radio data. Only emit the bridge protocol and bounded error messages.
    sys.stdout = open(devnull, "w", encoding="utf-8")
    logging.disable(logging.CRITICAL)
    try:
        if version("meshtastic") != CLIENT_VERSION:
            raise PackageNotFoundError
        from meshtastic.protobuf import channel_pb2, config_pb2, portnums_pb2
        from meshtastic.serial_interface import SerialInterface
        from meshtastic.stream_interface import HEADER_LEN
        from pubsub import pub
    except (ImportError, PackageNotFoundError):
        emit("fatal", error=f"Install meshtastic=={CLIENT_VERSION} in the bridge's Python environment")
        return 1

    private_port = portnums_pb2.PortNum.PRIVATE_APP
    broadcast = 0xFFFFFFFF
    discovery_marker = b"D"

    class BridgeError(Exception):
        pass

    class Radio(SerialInterface):
        def __init__(self):
            self.write_lock = Lock()
            self.queue_changed = Condition()
            self.queue_sample = None
            self.submission = None
            super().__init__(devPath=port, timeout=5)

        def _writeBytes(self, body):
            with self.write_lock:
                stream = self.stream
                if stream is None or stream.write(body) != len(body):
                    raise BridgeError("Meshtastic serial write incomplete; submission uncertain")
                stream.flush()
                sleep(0.1)  # Preserve the upstream stream interface's serial pacing.

        def _queue_has_room(self):
            if self.queue_sample is None:
                return False
            free, capacity, sampled_at = self.queue_sample
            return monotonic() - sampled_at < 1 and free > max(0, capacity - MAX_QUEUED_PACKETS)

        def _wait_for_queue_room(self):
            deadline = monotonic() + 2
            while not self._queue_has_room():
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise BridgeError("Meshtastic radio queue headroom was not observed")
                self.sendHeartbeat()
                with self.queue_changed:
                    self.queue_changed.wait_for(self._queue_has_room, min(0.25, remaining))

        def _sendToRadio(self, to_radio):
            if not to_radio.HasField("packet"):
                super()._sendToRadio(to_radio)
                return

            if HEADER_LEN + to_radio.ByteSize() > MAX_SERIAL_FRAME_BYTES:
                raise BridgeError("Meshtastic serial frame exceeds 256 bytes")

            self._wait_for_queue_room()
            # Use one local submission at a time. The library's normal queue can
            # resend a packet whose queue status was lost, even after admission.
            admission = Event()
            result = []
            self.submission = (to_radio.packet.id, admission, result)
            try:
                self._sendToRadioImpl(to_radio)
                if not admission.wait(2):
                    raise BridgeError("Meshtastic radio admission was not observed; submission uncertain")
                if result[0]:
                    raise BridgeError(f"Meshtastic radio rejected submission with status {result[0]}")
            finally:
                self.submission = None

        def _handleQueueStatusFromRadio(self, status):
            if 0 < status.maxlen and 0 <= status.free <= status.maxlen:
                with self.queue_changed:
                    self.queue_sample = (status.free, status.maxlen, monotonic())
                    self.queue_changed.notify_all()
            submission = self.submission
            if submission is not None and status.mesh_packet_id == submission[0]:
                _, admission, result = submission
                result.append(status.res)
                admission.set()

    radio = None
    local_key = None

    def receive(interface, packet):
        if interface is not radio or local_key is None or not radio.isConnected.is_set():
            return
        raw = packet["raw"]
        sender = getattr(raw, "from")
        if (sender in (0, local_num, broadcast) or raw.via_mqtt or not raw.HasField("decoded") or
                raw.decoded.portnum != private_port):
            return
        body = raw.decoded.payload
        key = cached_key(radio.nodesByNum.get(sender, {}))
        if key is None:
            return
        if raw.to == local_num and raw.pki_encrypted and key == raw.public_key and 0 < len(body) <= MAX_BODY_BYTES:
            emit("packet", peer=key.hex(), body=b64encode(body).decode("ascii"))
        elif raw.to == broadcast and not raw.pki_encrypted and raw.channel == discovery_channel:
            if len(body) == 41 and body[:33] == discovery_marker + local_key:
                emit("discovery", peer=key.hex(), nonce=body[33:].hex())
            elif len(body) == 9 and body[:1] == b"S":
                emit("beacon", peer=key.hex(), nonce=body[1:].hex())

    def disconnected(interface):
        if interface is radio:
            emit("fatal", error="Meshtastic radio disconnected")

    topic = "meshtastic.receive.data.PRIVATE_APP"
    pub.subscribe(receive, topic)
    pub.subscribe(disconnected, "meshtastic.connection.lost")
    try:
        try:
            radio = Radio()
            local_num = radio.myInfo.my_node_num
            local_key = cached_key(radio.nodesByNum.get(local_num, {}))
            if local_num in (0, broadcast) or local_key is None:
                raise BridgeError("Meshtastic radio has no usable local identity")
            device = radio.localNode.localConfig.device
            if device.rebroadcast_mode == config_pb2.Config.DeviceConfig.CORE_PORTNUMS_ONLY:
                raise BridgeError(
                    "Set device.rebroadcast_mode to ALL after selecting the radio role "
                    "so it can receive Atlas packets"
                )
            channel = radio.localNode.getChannelByChannelIndex(discovery_channel)
            if (channel is None or channel.role == channel_pb2.Channel.Role.DISABLED or
                    len(channel.settings.psk) != 32 or not any(channel.settings.psk)):
                raise BridgeError("Set a private 32-byte PSK on the Meshtastic discovery channel")
        except BridgeError as error:
            emit("fatal", error=str(error))
            return 1
        except Exception:
            emit("fatal", error="Could not complete the Meshtastic serial handshake")
            return 1

        lora = radio.localNode.localConfig.lora
        if not lora.use_preset or lora.modem_preset != config_pb2.Config.LoRaConfig.SHORT_TURBO:
            emit("fatal", error="Provision the Meshtastic radio with ShortTurbo")
            return 1
        emit("ready")
        for line in sys.stdin:
            try:
                request = json.loads(line)
                request_id = request["id"]
                if type(request_id) is not int:
                    raise ValueError
                peer = request.get("peer")
                key = bytes.fromhex(peer) if peer is not None else None
                if key is not None and (len(key) != 32 or not any(key) or peer != key.hex()):
                    raise ValueError
                if "nonce" in request:
                    nonce = bytes.fromhex(request["nonce"])
                    if len(nonce) != 8 or request["nonce"] != nonce.hex():
                        raise ValueError
                    body = (b"S" if key is None else discovery_marker + key) + nonce
                else:
                    body = b64decode(request["body"], validate=True)
                    if key is None or not 0 < len(body) <= MAX_BODY_BYTES:
                        raise ValueError
            except (KeyError, TypeError, ValueError):
                emit("fatal", error="Invalid submission to the Meshtastic serial bridge")
                return 1

            try:
                if "nonce" in request:
                    radio.sendData(body, portNum=private_port,
                                   channelIndex=discovery_channel, wantAck=False, hopLimit=1)
                    emit("submission", id=request_id, error=None)
                    continue
                destinations = [number for number, node in radio.nodesByNum.copy().items()
                                if number not in (0, local_num, broadcast) and cached_key(node) == key]
                if len(destinations) != 1:
                    raise BridgeError("Meshtastic radio does not know a unique node for the peer key")
                radio.sendData(body, destinationId=destinations[0], portNum=private_port,
                               pkiEncrypted=True, publicKey=key, wantAck=False, hopLimit=1)
            except BridgeError as error:
                emit("submission", id=request_id, error=str(error))
            except Exception:
                emit("submission", id=request_id, error="Meshtastic serial submission failed; admission uncertain")
            else:
                emit("submission", id=request_id, error=None)
    finally:
        pub.unsubscribe(receive, topic)
        pub.unsubscribe(disconnected, "meshtastic.connection.lost")
        if radio is not None:
            with suppress(Exception):
                radio.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], int(sys.argv[2])))
