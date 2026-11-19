export interface CoreConfig {
  listen_address: string;
  port: number;
  tls_certificate: string | null;
  tls_key: string | null;
  data_directory: string;
  first_admin: { operator_id: string; password_file: string } | null;
  offline_after_s: number;
  stream_keepalive_s: number;
  max_object_bytes: number;
  clock_ahead_s: number;
  log_level: "error" | "warn" | "info" | "debug" | "trace";
  log_directory: string;
  log_message_content: boolean;
  log_file_limit_bytes: number;
  log_total_limit_bytes: number;
  debug_endpoint: boolean;
  archive_directory: string;
}
