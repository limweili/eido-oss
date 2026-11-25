#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <aclapi.h>
#include <stdio.h>
#include <stdlib.h>

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

static int anonymous_access_is_denied(const char *endpoint) {
  HANDLE attempted;
  DWORD attempted_error;
  if (!ImpersonateAnonymousToken(GetCurrentThread())) return 0;
  attempted = CreateFileA(
    endpoint,
    GENERIC_READ | GENERIC_WRITE,
    0U,
    NULL,
    OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL,
    NULL
  );
  attempted_error = GetLastError();
  if (!RevertToSelf()) {
    if (attempted != INVALID_HANDLE_VALUE) CloseHandle(attempted);
    return 0;
  }
  if (attempted != INVALID_HANDLE_VALUE) {
    CloseHandle(attempted);
    return 0;
  }
  return attempted_error == ERROR_ACCESS_DENIED;
}

static int pipe_dacl_allows_only_current_user(HANDLE pipe) {
  const DWORD generic_read_write = GENERIC_READ | GENERIC_WRITE;
  const DWORD mapped_read_write = FILE_GENERIC_READ | FILE_GENERIC_WRITE;
  HANDLE token = NULL;
  PTOKEN_USER user = NULL;
  PSECURITY_DESCRIPTOR descriptor = NULL;
  PACL dacl = NULL;
  ACL_SIZE_INFORMATION information;
  void *candidate_ace = NULL;
  ACCESS_ALLOWED_ACE *allowed_ace;
  int matches = 0;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) goto cleanup;
  user = read_token_user(token);
  if (user == NULL) goto cleanup;
  if (GetSecurityInfo(
    pipe,
    SE_KERNEL_OBJECT,
    DACL_SECURITY_INFORMATION,
    NULL,
    NULL,
    &dacl,
    NULL,
    &descriptor
  ) != ERROR_SUCCESS || dacl == NULL) {
    goto cleanup;
  }
  ZeroMemory(&information, sizeof(information));
  if (!GetAclInformation(
    dacl,
    &information,
    sizeof(information),
    AclSizeInformation
  ) || information.AceCount != 1U || !GetAce(dacl, 0U, &candidate_ace)) {
    goto cleanup;
  }
  if (((ACE_HEADER *)candidate_ace)->AceType != ACCESS_ALLOWED_ACE_TYPE) {
    goto cleanup;
  }
  allowed_ace = (ACCESS_ALLOWED_ACE *)candidate_ace;
  matches = EqualSid(&allowed_ace->SidStart, user->User.Sid) != FALSE
    && (allowed_ace->Mask == generic_read_write
      || allowed_ace->Mask == mapped_read_write);
cleanup:
  if (descriptor != NULL) LocalFree(descriptor);
  free(user);
  if (token != NULL) CloseHandle(token);
  return matches;
}

int main(int argc, char **argv) {
  HANDLE pipe;
  if (argc != 2 || argv[1][0] == '\0') {
    fputs("usage: eido-pipe-security-probe PIPE\n", stderr);
    return 2;
  }
  if (!anonymous_access_is_denied(argv[1])) {
    fputs("anonymous principal was not rejected by the pipe DACL\n", stderr);
    return 10;
  }
  pipe = CreateFileA(
    argv[1],
    GENERIC_READ | GENERIC_WRITE | READ_CONTROL,
    0U,
    NULL,
    OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL,
    NULL
  );
  if (pipe == INVALID_HANDLE_VALUE) {
    fprintf(stderr, "current user could not inspect the pipe DACL: %lu\n", GetLastError());
    return 11;
  }
  if (!pipe_dacl_allows_only_current_user(pipe)) {
    CloseHandle(pipe);
    fputs("pipe DACL is not exactly current-user-only\n", stderr);
    return 12;
  }
  CloseHandle(pipe);
  puts("anonymous denied; owner-only DACL verified");
  return 0;
}
