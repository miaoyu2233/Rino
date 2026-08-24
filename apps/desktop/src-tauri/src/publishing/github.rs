use std::{
    ffi::{OsStr, OsString},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::Serialize;

use super::{
    error::{PublishingError, PublishingErrorCode, PublishingResult},
    manifest::PackageOptions,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAXIMUM_RELEASE_ASSETS: usize = 1_000;
const MAXIMUM_RELEASE_ASSET_OUTPUT_BYTES: usize = 256 * 1024;
const AUTHENTICATION_STATUS_TIMEOUT: Duration = Duration::from_secs(15);
const AUTHENTICATION_LOGIN_TIMEOUT: Duration = Duration::from_mins(10);
const AUTHENTICATION_LOGOUT_TIMEOUT: Duration = Duration::from_secs(30);
const AUTH_TOKEN_ENVIRONMENTS: [&str; 4] = [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
];
const PRIVATE_COMMAND_ENVIRONMENTS: [(&str, &str); 4] = [
    ("GH_TELEMETRY", "false"),
    ("DO_NOT_TRACK", "1"),
    ("GH_NO_UPDATE_NOTIFIER", "1"),
    ("GH_NO_EXTENSION_UPDATE_NOTIFIER", "1"),
];
const DEBUG_ENVIRONMENTS: [&str; 2] = ["GH_DEBUG", "DEBUG"];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    pub available: bool,
    pub authenticated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPublishOutput {
    pub repository_url: String,
    pub release_url: String,
    pub created_repository: bool,
}

fn github_cli_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates.push(
            PathBuf::from(program_files)
                .join("GitHub CLI")
                .join("gh.exe"),
        );
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("GitHub CLI")
                .join("gh.exe"),
        );
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn command(cli: &Path, arguments: &[OsString]) -> Command {
    let mut command = Command::new(cli);
    command.args(arguments).env("GH_HOST", "github.com");
    for (environment, value) in PRIVATE_COMMAND_ENVIRONMENTS {
        command.env(environment, value);
    }
    for environment in AUTH_TOKEN_ENVIRONMENTS {
        command.env_remove(environment);
    }
    for environment in DEBUG_ENVIRONMENTS {
        command.env_remove(environment);
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn run(cli: &Path, arguments: &[OsString]) -> PublishingResult<Output> {
    let mut command = command(cli, arguments);
    command.output().map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::GithubCommandFailed,
            "githubCli",
            &error,
        )
    })
}

fn arguments(items: &[&OsStr]) -> Vec<OsString> {
    items.iter().map(|item| (*item).to_os_string()).collect()
}

fn run_private(
    cli: &Path,
    arguments: &[OsString],
    input: Option<&[u8]>,
    timeout: Duration,
    detail: &'static str,
) -> PublishingResult<ExitStatus> {
    let mut command = command(cli, arguments);
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| {
        PublishingError::from_io(PublishingErrorCode::GithubCommandFailed, detail, &error)
    })?;

    if let Some(input) = input {
        let write_result = child
            .stdin
            .take()
            .ok_or_else(|| PublishingError::new(PublishingErrorCode::GithubCommandFailed, detail))?
            .write_all(input);
        if let Err(error) = write_result {
            let _ignored = child.kill();
            let _ignored = child.wait();
            return Err(PublishingError::from_io(
                PublishingErrorCode::GithubCommandFailed,
                detail,
                &error,
            ));
        }
    }

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ignored = child.kill();
                let _ignored = child.wait();
                return Err(PublishingError::new(
                    PublishingErrorCode::GithubCommandFailed,
                    detail,
                ));
            }
            Err(error) => {
                let _ignored = child.kill();
                let _ignored = child.wait();
                return Err(PublishingError::from_io(
                    PublishingErrorCode::GithubCommandFailed,
                    detail,
                    &error,
                ));
            }
        }
    }
}

fn is_missing_lookup(success: bool, stderr: &[u8], fragments: &[&str]) -> bool {
    if success {
        return false;
    }
    let stderr = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    fragments.iter().all(|fragment| stderr.contains(fragment))
}

fn authentication_status_arguments() -> Vec<OsString> {
    arguments(&[
        OsStr::new("auth"),
        OsStr::new("status"),
        OsStr::new("--active"),
        OsStr::new("--hostname"),
        OsStr::new("github.com"),
    ])
}

fn login_arguments() -> Vec<OsString> {
    arguments(&[
        OsStr::new("auth"),
        OsStr::new("login"),
        OsStr::new("--hostname"),
        OsStr::new("github.com"),
        OsStr::new("--web"),
        OsStr::new("--clipboard"),
        OsStr::new("--git-protocol"),
        OsStr::new("https"),
        OsStr::new("--skip-ssh-key"),
    ])
}

fn logout_arguments() -> Vec<OsString> {
    arguments(&[
        OsStr::new("auth"),
        OsStr::new("logout"),
        OsStr::new("--hostname"),
        OsStr::new("github.com"),
    ])
}

fn authenticated(cli: &Path) -> PublishingResult<bool> {
    run_private(
        cli,
        &authentication_status_arguments(),
        None,
        AUTHENTICATION_STATUS_TIMEOUT,
        "githubAuthenticationStatus",
    )
    .map(|status| status.success())
}

fn is_missing_repository(output: &Output) -> bool {
    is_missing_lookup(
        output.status.success(),
        &output.stderr,
        &["could not resolve to a repository"],
    ) || is_missing_lookup(
        output.status.success(),
        &output.stderr,
        &["repository not found"],
    )
}

fn is_missing_release(output: &Output) -> bool {
    is_missing_lookup(
        output.status.success(),
        &output.stderr,
        &["release", "not found"],
    )
}

#[must_use]
pub fn status() -> GithubStatus {
    let Some(cli) = github_cli_path() else {
        return GithubStatus {
            available: false,
            authenticated: false,
        };
    };
    GithubStatus {
        available: true,
        authenticated: authenticated(&cli).unwrap_or(false),
    }
}

pub fn login() -> PublishingResult<GithubStatus> {
    let cli = github_cli_path().ok_or_else(|| {
        PublishingError::new(PublishingErrorCode::GithubCliUnavailable, "githubCli")
    })?;
    if authenticated(&cli)? {
        return Ok(GithubStatus {
            available: true,
            authenticated: true,
        });
    }

    let login_status = run_private(
        &cli,
        &login_arguments(),
        Some(b"\n"),
        AUTHENTICATION_LOGIN_TIMEOUT,
        "githubAuthenticationLogin",
    )?;
    if !login_status.success() || !authenticated(&cli)? {
        return Err(PublishingError::new(
            PublishingErrorCode::GithubAuthenticationFailed,
            "githubAuthenticationLogin",
        ));
    }
    Ok(GithubStatus {
        available: true,
        authenticated: true,
    })
}

pub fn logout() -> PublishingResult<GithubStatus> {
    let cli = github_cli_path().ok_or_else(|| {
        PublishingError::new(PublishingErrorCode::GithubCliUnavailable, "githubCli")
    })?;
    if !authenticated(&cli)? {
        return Ok(GithubStatus {
            available: true,
            authenticated: false,
        });
    }

    let logout_status = run_private(
        &cli,
        &logout_arguments(),
        None,
        AUTHENTICATION_LOGOUT_TIMEOUT,
        "githubAuthenticationLogout",
    )?;
    if !logout_status.success() || authenticated(&cli)? {
        return Err(PublishingError::new(
            PublishingErrorCode::GithubLogoutFailed,
            "githubAuthenticationLogout",
        ));
    }
    Ok(GithubStatus {
        available: true,
        authenticated: false,
    })
}

fn run_success(cli: &Path, arguments: &[OsString], detail: &'static str) -> PublishingResult<()> {
    let output = run(cli, arguments)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(PublishingError::new(
            PublishingErrorCode::GithubCommandFailed,
            detail,
        ))
    }
}

fn repository_visibility(
    cli: &Path,
    repository_reference: &str,
) -> PublishingResult<Option<String>> {
    let output = run(
        cli,
        &[
            OsString::from("repo"),
            OsString::from("view"),
            OsString::from(repository_reference),
            OsString::from("--json"),
            OsString::from("visibility"),
            OsString::from("--jq"),
            OsString::from(".visibility"),
        ],
    )?;
    if !output.status.success() {
        if is_missing_repository(&output) {
            return Ok(None);
        }
        return Err(PublishingError::new(
            PublishingErrorCode::GithubCommandFailed,
            "repositoryView",
        ));
    }
    let visibility = String::from_utf8(output.stdout).map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::GithubCommandFailed,
            "repositoryVisibilityEncoding",
        )
    })?;
    let visibility = visibility.trim();
    if visibility.is_empty() {
        return Err(PublishingError::new(
            PublishingErrorCode::GithubCommandFailed,
            "repositoryVisibilityOutput",
        ));
    }
    Ok(Some(visibility.to_owned()))
}

fn release_asset_names(
    cli: &Path,
    repository_reference: &str,
    release_tag: &str,
) -> PublishingResult<Option<Vec<String>>> {
    let output = run(
        cli,
        &[
            OsString::from("release"),
            OsString::from("view"),
            OsString::from(release_tag),
            OsString::from("--repo"),
            OsString::from(repository_reference),
            OsString::from("--json"),
            OsString::from("assets"),
            OsString::from("--jq"),
            OsString::from(".assets[].name"),
        ],
    )?;
    if !output.status.success() {
        if is_missing_release(&output) {
            return Ok(None);
        }
        return Err(PublishingError::new(
            PublishingErrorCode::GithubCommandFailed,
            "releaseView",
        ));
    }
    if output.stdout.len() > MAXIMUM_RELEASE_ASSET_OUTPUT_BYTES {
        return Err(PublishingError::new(
            PublishingErrorCode::GithubCommandFailed,
            "releaseAssetsOutput",
        ));
    }
    let text = String::from_utf8(output.stdout).map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::GithubCommandFailed,
            "releaseAssetsEncoding",
        )
    })?;
    let names = text
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if names.len() > MAXIMUM_RELEASE_ASSETS || names.iter().any(|name| name.len() > 255) {
        return Err(PublishingError::new(
            PublishingErrorCode::GithubCommandFailed,
            "releaseAssetsShape",
        ));
    }
    Ok(Some(names))
}

fn release_upload_arguments(
    repository_reference: &str,
    release_tag: &str,
    package_path: &Path,
) -> Vec<OsString> {
    vec![
        OsString::from("release"),
        OsString::from("upload"),
        OsString::from(release_tag),
        package_path.as_os_str().to_os_string(),
        OsString::from("--repo"),
        OsString::from(repository_reference),
    ]
}

fn ensure_release_asset_available(
    release_assets: &[String],
    asset_name: &str,
) -> PublishingResult<()> {
    if release_assets.iter().any(|name| name == asset_name) {
        return Err(PublishingError::new(
            PublishingErrorCode::PackageVersionExists,
            "releaseAssetExists",
        ));
    }
    Ok(())
}

pub fn publish(
    package_path: &Path,
    options: &PackageOptions,
) -> PublishingResult<GithubPublishOutput> {
    options.validate()?;
    let cli = github_cli_path().ok_or_else(|| {
        PublishingError::new(PublishingErrorCode::GithubCliUnavailable, "githubCli")
    })?;
    if !authenticated(&cli)? {
        return Err(PublishingError::new(
            PublishingErrorCode::GithubAuthenticationRequired,
            "githubAuthentication",
        ));
    }

    let repository_reference = format!("{}/{}", options.github_owner, options.github_repository);
    let visibility = repository_visibility(&cli, &repository_reference)?;
    let created_repository = if let Some(visibility) = visibility {
        if visibility != "PUBLIC" {
            return Err(PublishingError::new(
                PublishingErrorCode::GithubCommandFailed,
                "repositoryNotPublic",
            ));
        }
        false
    } else {
        run_success(
            &cli,
            &[
                OsString::from("repo"),
                OsString::from("create"),
                OsString::from(&repository_reference),
                OsString::from("--public"),
                OsString::from("--add-readme"),
                OsString::from("--description"),
                OsString::from(&options.summary),
                OsString::from("--disable-issues"),
                OsString::from("--disable-wiki"),
            ],
            "repositoryCreate",
        )?;
        true
    };

    let release_tag = options.release_tag();
    let release_assets = release_asset_names(&cli, &repository_reference, &release_tag)?;

    if let Some(release_assets) = release_assets {
        ensure_release_asset_available(&release_assets, &options.asset_name())?;
        run_success(
            &cli,
            &release_upload_arguments(&repository_reference, &release_tag, package_path),
            "releaseUpload",
        )?;
    } else {
        run_success(
            &cli,
            &[
                OsString::from("release"),
                OsString::from("create"),
                OsString::from(&release_tag),
                package_path.as_os_str().to_os_string(),
                OsString::from("--repo"),
                OsString::from(&repository_reference),
                OsString::from("--title"),
                OsString::from(format!("{} {}", options.package_id, options.version)),
                OsString::from("--notes"),
                OsString::from("Published explicitly from Rino."),
                OsString::from("--latest"),
            ],
            "releaseCreate",
        )?;
    }

    let repository_url = format!("https://github.com/{repository_reference}");
    Ok(GithubPublishOutput {
        release_url: format!("{repository_url}/releases/tag/{release_tag}"),
        repository_url,
        created_repository,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_does_not_require_a_path_from_the_frontend() {
        let candidate = github_cli_path();
        assert!(candidate.is_none_or(|path| path.ends_with("gh.exe")));
    }

    #[test]
    fn status_serialization_exposes_no_account_identifier() {
        let value = serde_json::to_value(GithubStatus {
            available: true,
            authenticated: true,
        })
        .unwrap_or(serde_json::Value::Null);
        assert_eq!(
            value,
            serde_json::json!({ "available": true, "authenticated": true })
        );
    }

    #[test]
    fn authentication_commands_never_accept_or_reveal_credentials() {
        let status = authentication_status_arguments();
        let login = login_arguments();
        let logout = logout_arguments();
        for command in [&status, &login, &logout] {
            assert!(!command.iter().any(|argument| argument == "--show-token"));
            assert!(!command.iter().any(|argument| argument == "--with-token"));
            assert!(
                !command
                    .iter()
                    .any(|argument| argument == "--insecure-storage")
            );
            assert!(!command.iter().any(|argument| argument == "api"));
        }
        assert!(login.iter().any(|argument| argument == "--web"));
        assert!(login.iter().any(|argument| argument == "--clipboard"));
        assert!(login.iter().any(|argument| argument == "--skip-ssh-key"));
    }

    #[test]
    fn authentication_environment_tokens_are_ignored() {
        assert_eq!(
            AUTH_TOKEN_ENVIRONMENTS,
            [
                "GH_TOKEN",
                "GITHUB_TOKEN",
                "GH_ENTERPRISE_TOKEN",
                "GITHUB_ENTERPRISE_TOKEN"
            ]
        );
    }

    #[test]
    fn github_cli_telemetry_and_update_checks_are_disabled() {
        assert_eq!(
            PRIVATE_COMMAND_ENVIRONMENTS,
            [
                ("GH_TELEMETRY", "false"),
                ("DO_NOT_TRACK", "1"),
                ("GH_NO_UPDATE_NOTIFIER", "1"),
                ("GH_NO_EXTENSION_UPDATE_NOTIFIER", "1")
            ]
        );
        assert_eq!(DEBUG_ENVIRONMENTS, ["GH_DEBUG", "DEBUG"]);
    }

    #[test]
    fn release_upload_never_clobbers_an_existing_asset() {
        let arguments = release_upload_arguments(
            "owner/repository",
            "v1.2.3",
            Path::new("package.rino-package"),
        );
        assert!(!arguments.iter().any(|argument| argument == "--clobber"));
    }

    #[test]
    fn existing_release_asset_is_immutable() {
        let assets = vec!["rino-project-v1.2.3.rino-package".to_owned()];
        let result = ensure_release_asset_available(&assets, "rino-project-v1.2.3.rino-package");
        assert!(result.is_err());
        let Err(error) = result else {
            unreachable!("the result was checked above")
        };

        assert_eq!(error.code, PublishingErrorCode::PackageVersionExists);
    }

    #[test]
    fn release_lookup_only_treats_explicit_not_found_as_absent() {
        assert!(is_missing_lookup(
            false,
            b"release not found",
            &["release", "not found"]
        ));
        assert!(!is_missing_lookup(
            false,
            b"network connection failed",
            &["release", "not found"]
        ));
    }

    #[test]
    fn repository_lookup_only_treats_explicit_not_found_as_absent() {
        assert!(is_missing_lookup(
            false,
            b"GraphQL: Could not resolve to a Repository",
            &["could not resolve to a repository"]
        ));
        assert!(!is_missing_lookup(
            false,
            b"permission denied",
            &["repository not found"]
        ));
    }
}
