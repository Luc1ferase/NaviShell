//! SSH: connections, PTY terminals, one-shot command execution and SFTP.
//!
//! One [`connection::Connection`] per `ssh_connect` owns a `russh` session handle. Every
//! terminal, exec call and the (lazily opened) SFTP session of that server share it by
//! opening their own channel on it.

pub mod connection;
pub mod exec;
pub mod sftp;
pub mod terminal;
