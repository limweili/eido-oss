#include "transport.h"

#include <aclapi.h>
#include <fcntl.h>
#include <io.h>
#include <sddl.h>
#include <stdio.h>
#include <stdlib.h>

int eido_transport_prepare_standard_streams(void) {
  return _setmode(_fileno(stdin), _O_BINARY) != -1
    && _setmode(_fileno(stdout), _O_BINARY) != -1;
}

static PTOKEN_USER read_token_user(HANDLE token) {
  DWORD required = 0U;
  PTOKEN_USER user;
  (void)GetTokenInformation(token, TokenUser, NULL, 0U, &required);
  if (required == 0U || GetLastError() != ERROR_INSUFFICIENT_BUFFER) return NULL;
  user = (PTOKEN_USER)malloc(required);
  if (user == NULL) return NULL;
  if (!GetTokenInformation(token, TokenUser, user, required, &required)) {
    free(user);
    return NULL;
  }
  return user;
}

static int process_user_matches_current_process(DWORD process_id) {
  HANDLE peer_process = NULL;
  HANDLE peer_token = NULL;
  HANDLE current_token = NULL;
  PTOKEN_USER peer_user = NULL;
  PTOKEN_USER current_user = NULL;
  int matches = 0;
  peer_process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
  if (peer_process == NULL) goto cleanup;
  if (!OpenProcessToken(peer_process, TOKEN_QUERY, &peer_token)) goto cleanup;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &current_token)) goto cleanup;
  peer_user = read_token_user(peer_token);
  current_user = read_token_user(current_token);
  if (peer_user != NULL && current_user != NULL) {
    matches = EqualSid(peer_user->User.Sid, current_user->User.Sid) != FALSE;
  }
cleanup:
  free(peer_user);
  free(current_user);
  if (peer_token != NULL) CloseHandle(peer_token);
  if (current_token != NULL) CloseHandle(current_token);
  if (peer_process != NULL) CloseHandle(peer_process);
  return matches;
}

enum eido_transport_connect_result eido_transport_connect_verified(
  const char *endpoint,
  eido_transport_handle *handle
) {
  HANDLE pipe;
  DWORD server_process_id = 0U;
  ULONGLONG busy_deadline;
  if (endpoint == NULL || endpoint[0] == '\0' || handle == NULL) {
    return EIDO_TRANSPORT_CONNECT_FAILED;
  }
  busy_deadline = GetTickCount64() + 5000U;
  for (;;) {
    DWORD open_error;
    ULONGLONG now;
    DWORD remaining;
    pipe = CreateFileA(
      endpoint,
      GENERIC_READ | GENERIC_WRITE,
      0U,
      NULL,
      OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL,
      NULL
    );
    if (pipe != INVALID_HANDLE_VALUE) break;
    open_error = GetLastError();
    if (open_error == ERROR_FILE_NOT_FOUND) {
      return EIDO_TRANSPORT_ENDPOINT_ABSENT;
    }
    if (open_error != ERROR_PIPE_BUSY) return EIDO_TRANSPORT_CONNECT_FAILED;
    now = GetTickCount64();
    if (now >= busy_deadline) return EIDO_TRANSPORT_CONNECT_FAILED;
    remaining = (DWORD)(busy_deadline - now);
    if (!WaitNamedPipeA(endpoint, remaining)
      && GetLastError() != ERROR_SEM_TIMEOUT) {
      return EIDO_TRANSPORT_CONNECT_FAILED;
    }
  }
  if (!GetNamedPipeServerProcessId(pipe, &server_process_id)
    || !process_user_matches_current_process(server_process_id)) {
    CloseHandle(pipe);
    return EIDO_TRANSPORT_PEER_REJECTED;
  }
  *handle = pipe;
  return EIDO_TRANSPORT_CONNECTED;
}

enum eido_transport_connect_result eido_transport_listen_verified(
  const char *endpoint,
  eido_transport_handle *listener
) {
  SECURITY_ATTRIBUTES attributes;
  PSECURITY_DESCRIPTOR descriptor = NULL;
  PACL acl = NULL;
  HANDLE pipe;
  if (endpoint == NULL || endpoint[0] == '\0' || listener == NULL) {
    return EIDO_TRANSPORT_CONNECT_FAILED;
  }
  fflush(stderr);
  if (!eido_transport_create_current_user_pipe_security(
    &attributes,
    &descriptor,
    &acl
  )) {
    return EIDO_TRANSPORT_CONNECT_FAILED;
  }
  fflush(stderr);
  pipe = CreateNamedPipeA(
    endpoint,
    PIPE_ACCESS_DUPLEX,
    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
    1U,
    64U * 1024U,
    64U * 1024U,
    0U,
    &attributes
  );
  fflush(stderr);
  eido_transport_free_pipe_security(descriptor, acl);
  if (pipe == INVALID_HANDLE_VALUE) return EIDO_TRANSPORT_CONNECT_FAILED;
  *listener = pipe;
  return EIDO_TRANSPORT_CONNECTED;
}

enum eido_transport_connect_result eido_transport_accept_verified(
  eido_transport_handle listener,
  eido_transport_handle *client
) {
  DWORD client_process_id = 0U;
  BOOL connected;
  if (client == NULL || listener == INVALID_HANDLE_VALUE) {
    return EIDO_TRANSPORT_CONNECT_FAILED;
  }
  connected = ConnectNamedPipe(listener, NULL);
  if (!connected && GetLastError() != ERROR_PIPE_CONNECTED) {
    return EIDO_TRANSPORT_CONNECT_FAILED;
  }
  if (!GetNamedPipeClientProcessId(listener, &client_process_id)
    || !process_user_matches_current_process(client_process_id)) {
    (void)DisconnectNamedPipe(listener);
    return EIDO_TRANSPORT_PEER_REJECTED;
  }
  *client = listener;
  return EIDO_TRANSPORT_CONNECTED;
}

int eido_transport_read_exact(
  eido_transport_handle handle,
  uint8_t *buffer,
  size_t length
) {
  size_t offset = 0U;
  while (offset < length) {
    DWORD chunk = length - offset > MAXDWORD ? MAXDWORD : (DWORD)(length - offset);
    DWORD read_count = 0U;
    if (!ReadFile(handle, buffer + offset, chunk, &read_count, NULL)
      || read_count == 0U) {
      return 0;
    }
    offset += (size_t)read_count;
  }
  return 1;
}

enum eido_transport_read_result eido_transport_read_exact_bounded(
  eido_transport_handle handle,
  uint8_t *buffer,
  size_t length,
  uint32_t timeout_milliseconds
) {
  ULONGLONG deadline;
  size_t offset = 0U;
  if (handle == INVALID_HANDLE_VALUE
    || buffer == NULL
    || length == 0U
    || timeout_milliseconds == 0U) {
    return EIDO_TRANSPORT_READ_FAILED;
  }
  deadline = GetTickCount64() + (ULONGLONG)timeout_milliseconds;
  while (offset < length) {
    DWORD available = 0U;
    DWORD chunk;
    DWORD read_count = 0U;
    ULONGLONG now;
    if (!PeekNamedPipe(handle, NULL, 0U, NULL, &available, NULL)) {
      DWORD read_error = GetLastError();
      return read_error == ERROR_BROKEN_PIPE
          || read_error == ERROR_NO_DATA
          || read_error == ERROR_PIPE_NOT_CONNECTED
        ? EIDO_TRANSPORT_READ_CLOSED
        : EIDO_TRANSPORT_READ_FAILED;
    }
    if (available == 0U) {
      DWORD sleep_milliseconds;
      now = GetTickCount64();
      if (now >= deadline) return EIDO_TRANSPORT_READ_TIMEOUT;
      sleep_milliseconds = (DWORD)(deadline - now);
      if (sleep_milliseconds > 10U) sleep_milliseconds = 10U;
      Sleep(sleep_milliseconds);
      continue;
    }
    chunk = length - offset > (size_t)available
      ? available
      : (DWORD)(length - offset);
    if (!ReadFile(handle, buffer + offset, chunk, &read_count, NULL)) {
      DWORD read_error = GetLastError();
      return read_error == ERROR_BROKEN_PIPE
          || read_error == ERROR_NO_DATA
          || read_error == ERROR_PIPE_NOT_CONNECTED
        ? EIDO_TRANSPORT_READ_CLOSED
        : EIDO_TRANSPORT_READ_FAILED;
    }
    if (read_count == 0U) return EIDO_TRANSPORT_READ_CLOSED;
    offset += (size_t)read_count;
  }
  return EIDO_TRANSPORT_READ_COMPLETE;
}

int eido_transport_write_all(
  eido_transport_handle handle,
  const uint8_t *buffer,
  size_t length
) {
  size_t offset = 0U;
  while (offset < length) {
    DWORD chunk = length - offset > MAXDWORD ? MAXDWORD : (DWORD)(length - offset);
    DWORD write_count = 0U;
    if (!WriteFile(handle, buffer + offset, chunk, &write_count, NULL)
      || write_count == 0U) {
      return 0;
    }
    offset += (size_t)write_count;
  }
  return 1;
}

void eido_transport_close(eido_transport_handle handle) {
  if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
}

void eido_transport_disconnect_client(
  eido_transport_handle listener,
  eido_transport_handle client
) {
  (void)client;
  if (listener != INVALID_HANDLE_VALUE) (void)DisconnectNamedPipe(listener);
}

void eido_transport_cleanup_endpoint(const char *endpoint) {
  (void)endpoint;
}

void eido_transport_emergency_cleanup_endpoint(const char *endpoint) {
  (void)endpoint;
}

int eido_transport_create_current_user_pipe_security(
  SECURITY_ATTRIBUTES *attributes,
  PSECURITY_DESCRIPTOR *descriptor,
  PACL *acl
) {
  HANDLE token = NULL;
  PTOKEN_USER user = NULL;
  EXPLICIT_ACCESSA access;
  DWORD acl_result;
  if (attributes == NULL || descriptor == NULL || acl == NULL) return 0;
  *descriptor = NULL;
  *acl = NULL;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return 0;
  user = read_token_user(token);
  CloseHandle(token);
  if (user == NULL) return 0;
  ZeroMemory(&access, sizeof(access));
  access.grfAccessPermissions = GENERIC_READ | GENERIC_WRITE;
  access.grfAccessMode = SET_ACCESS;
  access.grfInheritance = NO_INHERITANCE;
  access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  access.Trustee.TrusteeType = TRUSTEE_IS_USER;
  access.Trustee.ptstrName = (LPSTR)user->User.Sid;
  acl_result = SetEntriesInAclA(1U, &access, NULL, acl);
  free(user);
  if (acl_result != ERROR_SUCCESS) return 0;
  *descriptor = (PSECURITY_DESCRIPTOR)LocalAlloc(
    LPTR,
    SECURITY_DESCRIPTOR_MIN_LENGTH
  );
  if (*descriptor == NULL
    || !InitializeSecurityDescriptor(*descriptor, SECURITY_DESCRIPTOR_REVISION)
    || !SetSecurityDescriptorDacl(*descriptor, TRUE, *acl, FALSE)) {
    eido_transport_free_pipe_security(*descriptor, *acl);
    *descriptor = NULL;
    *acl = NULL;
    return 0;
  }
  attributes->nLength = sizeof(*attributes);
  attributes->lpSecurityDescriptor = *descriptor;
  attributes->bInheritHandle = FALSE;
  return 1;
}

void eido_transport_free_pipe_security(
  PSECURITY_DESCRIPTOR descriptor,
  PACL acl
) {
  if (descriptor != NULL) LocalFree(descriptor);
  if (acl != NULL) LocalFree(acl);
}
