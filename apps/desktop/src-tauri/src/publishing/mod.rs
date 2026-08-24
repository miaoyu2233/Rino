use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

mod cache;
pub mod commands;
mod error;
mod github;
mod manifest;
mod package;
mod signing;

pub struct PublishingState {
    cache_root: PathBuf,
    operation_active: AtomicBool,
}

struct PublishingOperation<'a>(&'a PublishingState);

impl Drop for PublishingOperation<'_> {
    fn drop(&mut self) {
        self.0.operation_active.store(false, Ordering::Release);
    }
}

impl PublishingState {
    #[must_use]
    pub const fn new(cache_root: PathBuf) -> Self {
        Self {
            cache_root,
            operation_active: AtomicBool::new(false),
        }
    }

    fn acquire_operation(&self) -> Option<PublishingOperation<'_>> {
        (!self.operation_active.swap(true, Ordering::AcqRel)).then_some(PublishingOperation(self))
    }
}

pub(crate) fn prepare_cache(cache_root: &std::path::Path) -> Result<(), std::io::Error> {
    // Startup must not silently retain a private package from a terminated upload. The
    // structured publishing error contains no path or user data, so it is safe to retain
    // as the local diagnostic source.
    cache::prepare(cache_root).map_err(std::io::Error::other)
}
