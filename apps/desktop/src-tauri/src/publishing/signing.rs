use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use keyring::{Entry, Error as KeyringError};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;

use super::error::{PublishingError, PublishingErrorCode, PublishingResult};

const CREDENTIAL_SERVICE: &str = "Rino Publishing";
const CREDENTIAL_USER: &str = "default-publisher-ed25519-v1";
const SIGNING_KEY_BYTES: usize = 32;

pub struct PublisherSigningKey(SigningKey);

impl PublisherSigningKey {
    pub fn load_or_create() -> PublishingResult<Self> {
        let entry = Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|_| {
            PublishingError::new(
                PublishingErrorCode::CredentialUnavailable,
                "credentialStore",
            )
        })?;
        match entry.get_secret() {
            Ok(bytes) => Self::from_secret(&bytes),
            Err(KeyringError::NoEntry) => {
                let mut secret = [0_u8; SIGNING_KEY_BYTES];
                getrandom::fill(&mut secret).map_err(|_| {
                    PublishingError::new(PublishingErrorCode::CredentialUnavailable, "secureRandom")
                })?;
                entry.set_secret(&secret).map_err(|_| {
                    PublishingError::new(
                        PublishingErrorCode::CredentialUnavailable,
                        "credentialWrite",
                    )
                })?;
                Ok(Self(SigningKey::from_bytes(&secret)))
            }
            Err(_) => Err(PublishingError::new(
                PublishingErrorCode::CredentialUnavailable,
                "credentialRead",
            )),
        }
    }

    fn from_secret(secret: &[u8]) -> PublishingResult<Self> {
        let bytes: [u8; SIGNING_KEY_BYTES] = secret.try_into().map_err(|_| {
            PublishingError::new(
                PublishingErrorCode::CredentialUnavailable,
                "credentialLength",
            )
        })?;
        Ok(Self(SigningKey::from_bytes(&bytes)))
    }

    #[cfg(test)]
    pub fn from_test_secret(secret: [u8; SIGNING_KEY_BYTES]) -> Self {
        Self(SigningKey::from_bytes(&secret))
    }

    #[must_use]
    pub fn sign(&self, message: &[u8]) -> [u8; 64] {
        self.0.sign(message).to_bytes()
    }

    #[must_use]
    pub fn public_key_base64(&self) -> String {
        STANDARD.encode(self.0.verifying_key().to_bytes())
    }

    #[must_use]
    pub fn key_id(&self, publisher_id: &str) -> String {
        let digest = Sha256::digest(self.0.verifying_key().to_bytes());
        let suffix = digest[..6].iter().fold(String::new(), |mut output, byte| {
            let _ignored = write!(output, "{byte:02x}");
            output
        });
        format!("{publisher_id}-{suffix}")
    }
}
