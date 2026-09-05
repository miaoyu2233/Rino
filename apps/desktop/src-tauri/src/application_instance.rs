//! Process-lifetime marker used by the Windows installer.

use std::io;

pub(super) const APPLICATION_MUTEX_NAME: &str = r"Local\Rino.Desktop.InstallationInUse.v1";

pub(super) struct ApplicationInstanceGuard {
    _platform: platform::ApplicationInstanceGuard,
}

impl ApplicationInstanceGuard {
    pub(super) fn register() -> io::Result<Self> {
        platform::ApplicationInstanceGuard::register().map(|platform| Self {
            _platform: platform,
        })
    }
}

#[cfg(windows)]
mod platform {
    #![allow(unsafe_code)]

    use std::ffi::OsStr;
    use std::io;
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    use super::APPLICATION_MUTEX_NAME;

    pub(super) struct ApplicationInstanceGuard(HANDLE);

    impl ApplicationInstanceGuard {
        pub(super) fn register() -> io::Result<Self> {
            let name = OsStr::new(APPLICATION_MUTEX_NAME)
                .encode_wide()
                .chain(iter::once(0))
                .collect::<Vec<_>>();
            // SAFETY: the security-attributes pointer is null, ownership is not requested,
            // and `name` is a live, nul-terminated UTF-16 buffer for the duration of the call.
            let handle = unsafe { CreateMutexW(ptr::null(), 0, name.as_ptr()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(handle))
        }
    }

    impl Drop for ApplicationInstanceGuard {
        fn drop(&mut self) {
            // SAFETY: this guard exclusively owns the handle returned by CreateMutexW and
            // closes it exactly once when the application process has finished running.
            unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::io;

    pub(super) struct ApplicationInstanceGuard;

    impl ApplicationInstanceGuard {
        pub(super) const fn register() -> io::Result<Self> {
            Ok(Self)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_mutex_registration_lives_for_the_guard_scope() -> io::Result<()> {
        let guard = ApplicationInstanceGuard::register()?;

        assert_eq!(
            APPLICATION_MUTEX_NAME,
            r"Local\Rino.Desktop.InstallationInUse.v1"
        );

        drop(guard);
        Ok(())
    }
}
