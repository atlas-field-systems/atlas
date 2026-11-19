package reset

import (
	"archive/zip"
	"encoding/binary"
	"fmt"
	"io"
	"io/fs"
	"sort"
	"strings"
)

const (
	localHeader      = 0x04034b50
	descriptorHeader = 0x08074b50
	centralHeader    = 0x02014b50
)

// archive/zip locates data using the central directory. Before deleting the
// run, also check what a reader following the local directory would extract.
func checkLocalHeaders(src io.ReaderAt, size int64, files []*zip.File) error {
	type entry struct {
		file *zip.File
		data int64
	}
	entries := make([]entry, 0, len(files))
	for _, file := range files {
		data, err := file.DataOffset()
		if err != nil {
			return err
		}
		entries = append(entries, entry{file, data})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].data < entries[j].data })
	var offset int64
	for _, entry := range entries {
		f := entry.file
		var header [30]byte
		if _, err := src.ReadAt(header[:], offset); err != nil {
			return err
		}
		u := binary.LittleEndian
		length := int64(u.Uint16(header[26:]))
		extra := int64(u.Uint16(header[28:]))
		if u.Uint32(header[:]) != localHeader || u.Uint16(header[6:]) != f.Flags || u.Uint16(header[8:]) != f.Method ||
			offset+30+length+extra != entry.data || !fs.ValidPath(f.Name) || f.Name == "." || strings.Contains(f.Name, "\\") {
			return fmt.Errorf("invalid local header for %q", f.Name)
		}
		name := make([]byte, length)
		if _, err := src.ReadAt(name, offset+30); err != nil {
			return err
		}
		if string(name) != f.Name {
			return fmt.Errorf("local name differs from directory for %q", f.Name)
		}
		if entry.data > size || f.CompressedSize64 > uint64(size-entry.data) {
			return fmt.Errorf("invalid compressed extent for %q", f.Name)
		}
		offset = entry.data + int64(f.CompressedSize64)
		if f.Flags&8 != 0 {
			length, err := descriptorSize(src, offset, f)
			if err != nil {
				return err
			}
			offset += length
		} else {
			compressed, uncompressed := u.Uint32(header[18:]), u.Uint32(header[22:])
			if u.Uint32(header[14:]) != f.CRC32 || (compressed != 0xffffffff && uint64(compressed) != f.CompressedSize64) ||
				(uncompressed != 0xffffffff && uint64(uncompressed) != f.UncompressedSize64) {
				return fmt.Errorf("local checksum or size differs from directory for %q", f.Name)
			}
		}
	}
	var signature [4]byte
	if _, err := src.ReadAt(signature[:], offset); err != nil {
		return err
	}
	if binary.LittleEndian.Uint32(signature[:]) != centralHeader {
		return fmt.Errorf("unexpected data before central directory")
	}
	return nil
}

func descriptorSize(src io.ReaderAt, offset int64, file *zip.File) (int64, error) {
	// Both generations of Core stream files. The legacy writer used ZIP64
	// descriptors even for small members. The signature is optional in ZIP.
	var buf [28]byte
	n, err := src.ReadAt(buf[:], offset)
	if err != nil && err != io.EOF {
		return 0, err
	}
	u := binary.LittleEndian
	for _, prefix := range []int{0, 4} {
		if prefix == 4 && (n < 4 || u.Uint32(buf[:]) != descriptorHeader) {
			continue
		}
		data := buf[prefix:n]
		if len(data) < 16 || u.Uint32(data) != file.CRC32 {
			continue
		}
		for _, length := range []int{12, 20} {
			if len(data) < length+4 {
				continue
			}
			next := u.Uint32(data[length:])
			if next != localHeader && next != centralHeader {
				continue
			}
			if length == 12 &&
				uint64(u.Uint32(data[4:])) == file.CompressedSize64 && uint64(u.Uint32(data[8:])) == file.UncompressedSize64 {
				return int64(prefix + length), nil
			}
			if length == 20 && u.Uint64(data[4:]) == file.CompressedSize64 && u.Uint64(data[12:]) == file.UncompressedSize64 {
				return int64(prefix + length), nil
			}
		}
	}
	return 0, fmt.Errorf("invalid data descriptor for %q", file.Name)
}
