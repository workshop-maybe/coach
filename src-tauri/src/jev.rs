//! Jev Mode: a second opinion and a line-break cleanup from TypeSafe's Jev model,
//! sent with the user's own API key (KTD1–KTD4, KTD19, KTD20). The key lives in
//! the OS keychain, status reads only `settings.json` and memory, and an ask is
//! checked before any key store is read, so a bad call never raises a prompt.
//!
//! # Command contract
//!
//! The web view calls `invoke(name, args)`. A failed command rejects with a
//! `JevError` object. A rejection that is a plain string comes from Tauri itself
//! (for example a missing argument) and should be read as kind `"other"`.
//!
//! | Command         | Args                       | Resolves to | Rejects with kinds |
//! |-----------------|----------------------------|-------------|--------------------|
//! | `jev_status`    | none                       | `JevStatus` | none |
//! | `jev_set_key`   | `{ key: string }`          | `JevStatus` | `invalidKey`, `keychain`, `settings` |
//! | `jev_clear_key` | none                       | `JevStatus` | `keychain`, `settings` |
//! | `jev_set_on`    | `{ on: boolean }`          | `JevStatus` | `keyMissing` (on with no key), `settings` |
//! | `jev_ask`       | `{ request: JevRequest }`  | `JevAnswers`| `off`, `other`, `tooLong`, `keyMissing`, `keychain`, `keyRefused`, `rateLimited`, `overloaded`, `unreachable` |
//!
//! `jev_status` never reads the key store. `jev_set_key` trims the key, makes no
//! network call, writes the keychain and then the settings, and turns Jev Mode on.
//! Where Linux has no Secret Service it keeps the key in memory for this run and
//! reports `storage: "session"`. `jev_clear_key` deletes the key and turns Jev
//! Mode off, and changes nothing unless the delete succeeds. `jev_set_on` with
//! `false` keeps the key. `jev_ask` checks, in order, that Jev Mode is on, that the
//! request is one of the two shapes below with no other field, and that it fits
//! the budget; only then does it read the key and post. It is never retried here.
//!
//! ```ts
//! type JevStatus = {
//!   on: boolean;                            // the switch as saved
//!   hasKey: boolean;                        // a key is held now; Jev is usable when on && hasKey
//!   storage: "keychain" | "session" | null; // null when hasKey is false
//!   hint: string | null;                    // the key's last four characters; null under 12 characters
//! };
//!
//! type JevErrorKind =
//!   | "off"         // Jev Mode is off; nothing was read or sent
//!   | "keyMissing"  // no key to send, or `jev_set_on(true)` with none; ask for the key again
//!   | "keyRefused"  // TypeSafe answered 401
//!   | "rateLimited" // 429
//!   | "overloaded"  // 529
//!   | "tooLong"     // over the question cap or token budget (refused before sending), or 413
//!   | "unreachable" // no connection, or no complete answer within 20 seconds
//!   | "other"       // any other status, a redirect, a malformed request or a malformed answer
//!   | "keychain"    // the OS key store refused or failed (a Deny, a dismissed unlock prompt)
//!   | "invalidKey"  // empty after trimming, over 512 characters, or not printable ASCII
//!   | "settings";   // settings.json exists but can't be read, so nothing was changed
//!
//! type JevError = {
//!   kind: JevErrorKind;
//!   status: number | null;     // for "other" only: the HTTP status TypeSafe answered with when it
//!                              // wasn't a success (redirects included); null for anything else
//!   retryAfter: number | null; // whole seconds from Retry-After, set only for rateLimited and overloaded
//! };
//! // No error carries text: nothing from TypeSafe, the HTTP library or the key.
//!
//! type JevCriteria = { true: string; false: string };
//!
//! // A second opinion (KTD7): one question per rubric point plus one overall.
//! // State and instruction keys are TypeSafe's wire names, so backticked
//! // references in question text (`reply`, `point`, `rubric_notes`, `task`) resolve.
//! type SecondOpinionRequest = {
//!   kind: "secondOpinion";
//!   state: {
//!     task: string;
//!     rubric_points: string[]; // the rubric's top-level list items, in order
//!     rubric_notes: string;    // the rubric's lines outside its list
//!     rubric: string;          // the full rubric
//!     reply: string;
//!   };
//!   // Exactly these keys: "p1" … "pN" for rubric_points[0] … rubric_points[N-1],
//!   // plus "overall". With no rubric points, only "overall".
//!   questions: Record<string, {
//!     type: "noul";
//!     instructions: string | { point?: string; rubric_notes?: string; question: string };
//!     criteria?: JevCriteria;
//!   }>;
//! };
//!
//! // A line-break cleanup (KTD17): one question per candidate break.
//! type LineBreaksRequest = {
//!   kind: "lineBreaks";
//!   state: string; // only the pasted text, each line tagged with its id ("L014| …")
//!   // Each key is the id of the line that may continue the one before it:
//!   // "L" and one to six digits, e.g. "L015".
//!   questions: Record<string, { type: "noul"; instructions: string; criteria?: JevCriteria }>;
//! };
//!
//! type JevRequest = SecondOpinionRequest | LineBreaksRequest;
//!
//! // Every requested id, each a probability from 0 to 1. Nothing else from TypeSafe.
//! type JevAnswers = { answers: Record<string, number> };
//! ```
//!
//! Any other field, at any level (a `model` field included), is refused as
//! `"other"`, as are other question types and keys outside the rules above.
//!
//! Budget (KTD19), checked in the web view and again here. For a value `v`,
//! `tokens(v) = Math.ceil(JSON.stringify(v).length / 4)`, taken separately for
//! `state` and for each question object (its key is not counted, since TypeSafe
//! doesn't send keys to the model). An ask is `tooLong` when it has more than 256
//! questions, when `tokens(state) + max(tokens(question)) > 32000`, or when
//! `tokens(state) + sum(tokens(question)) > 64000`. Rust counts characters where
//! JS `.length` counts UTF-16 units, so the web view's check is never looser.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, RETRY_AFTER};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::{Zeroize, Zeroizing};

use crate::settings::{JevSettings, KeyStorage, SettingsFile, UpdateError};

/// The one service Jev Mode contacts, and the model it pins (KTD1).
pub const ENDPOINT: &str = "https://api.typesafe.ai/v1/systemone";
pub const MODEL: &str = "jev-1.13.0";
const TIMEOUT: Duration = Duration::from_secs(20);
/// Answers for the most questions an ask may carry fit well inside this.
const MAX_RESPONSE_BYTES: usize = 256 * 1024;
pub const MAX_QUESTIONS: usize = 256;
/// Jev 1.13's limits: state plus the longest question, and state plus all questions.
pub const STATE_PLUS_LONGEST_TOKENS: usize = 32_000;
pub const STATE_PLUS_ALL_TOKENS: usize = 64_000;
pub const MAX_KEY_CHARS: usize = 512;
/// Shorter keys get no hint, since four characters would give away too much of them.
const HINT_MIN_CHARS: usize = 12;
/// The one keychain entry. Setting a new key overwrites it.
const KEYCHAIN_SERVICE: &str = "io.andamio.desktop";
const KEYCHAIN_ACCOUNT: &str = "typesafe-api-key";

/// Each failure kind gets its own line in the UI (KTD20).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Off,
    KeyMissing,
    KeyRefused,
    RateLimited,
    Overloaded,
    TooLong,
    Unreachable,
    Other,
    Keychain,
    InvalidKey,
    Settings,
}

/// What the web view gets when a command fails. It holds no text at all, so
/// nothing from TypeSafe, the HTTP library or the key can reach it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JevError {
    pub kind: Kind,
    /// The HTTP status, for `other` only.
    pub status: Option<u16>,
    /// Whole seconds to wait, for `rateLimited` and `overloaded`, when TypeSafe says.
    pub retry_after: Option<u32>,
}

impl JevError {
    pub fn of(kind: Kind) -> Self {
        JevError { kind, status: None, retry_after: None }
    }
}

impl From<UpdateError> for JevError {
    fn from(_: UpdateError) -> Self {
        JevError::of(Kind::Settings)
    }
}

/// The user's TypeSafe key. It prints as a placeholder and is wiped from memory
/// when dropped (KTD2).
#[derive(Clone)]
pub struct ApiKey(String);

impl ApiKey {
    fn expose(&self) -> &str {
        &self.0
    }
}

impl Drop for ApiKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl std::fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApiKey(<redacted>)")
    }
}

impl std::fmt::Display for ApiKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("<redacted>")
    }
}

/// Trims a key as entered and refuses an empty, over-long or non-printable one.
/// Entering a key makes no network call; a bad key shows on the first ask (KTD4).
pub fn parse_key(raw: &str) -> Result<ApiKey, JevError> {
    let key = raw.trim();
    let printable = key.bytes().all(|b| (0x20..=0x7e).contains(&b));
    if key.is_empty() || key.len() > MAX_KEY_CHARS || !printable {
        return Err(JevError::of(Kind::InvalidKey));
    }
    Ok(ApiKey(key.to_string()))
}

/// The key's last four characters, for keys long enough to spare them.
fn hint_for(key: &ApiKey) -> Option<String> {
    let key = key.expose();
    (key.len() >= HINT_MIN_CHARS).then(|| key[key.len() - 4..].to_string())
}

/// Where the key is kept between runs.
pub trait KeyStore: Send + Sync {
    /// The stored key, or None when there is none.
    fn read(&self) -> Result<Option<ApiKey>, StoreError>;
    /// Writes the key over any earlier one.
    fn write(&self, key: &ApiKey) -> Result<(), StoreError>;
    /// Deletes the key. Deleting a key that isn't there succeeds.
    fn delete(&self) -> Result<(), StoreError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreError {
    /// No Secret Service on this Linux session: the only error that falls back
    /// to a key held for the session.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Unavailable,
    /// Anything else, including a dismissed unlock prompt or a macOS Deny.
    Failed,
}

/// The OS keychain through keyring-core, with the store chosen per platform.
pub struct Keychain {
    store: Result<Arc<keyring_core::CredentialStore>, StoreError>,
}

impl Keychain {
    /// Opens this platform's store and makes it keyring-core's default, so no
    /// other store is ever picked (KTD2).
    pub fn open() -> Self {
        let store = platform_store();
        if let Ok(store) = &store {
            keyring_core::set_default_store(store.clone());
        }
        Keychain { store }
    }

    fn entry(&self) -> Result<keyring_core::Entry, StoreError> {
        let store = self.store.as_ref().map_err(|e| *e)?;
        store
            .build(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, None)
            .map_err(|_| StoreError::Failed)
    }
}

impl KeyStore for Keychain {
    fn read(&self) -> Result<Option<ApiKey>, StoreError> {
        match self.entry()?.get_password() {
            Ok(key) => Ok(Some(ApiKey(key))),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(_) => Err(StoreError::Failed),
        }
    }

    fn write(&self, key: &ApiKey) -> Result<(), StoreError> {
        self.entry()?.set_password(key.expose()).map_err(|_| StoreError::Failed)
    }

    fn delete(&self) -> Result<(), StoreError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(StoreError::Failed),
        }
    }
}

#[cfg(target_os = "macos")]
fn platform_store() -> Result<Arc<keyring_core::CredentialStore>, StoreError> {
    match apple_native_keyring_store::keychain::Store::new() {
        Ok(store) => Ok(store),
        Err(_) => Err(StoreError::Failed),
    }
}

#[cfg(target_os = "linux")]
fn platform_store() -> Result<Arc<keyring_core::CredentialStore>, StoreError> {
    match zbus_secret_service_keyring_store::Store::new() {
        Ok(store) => Ok(store),
        Err(e) if secret_service_unavailable(&e) => Err(StoreError::Unavailable),
        Err(_) => Err(StoreError::Failed),
    }
}

/// True only for "no Secret Service provider or D-Bus session", which the store
/// reports when it first connects.
#[cfg(target_os = "linux")]
fn secret_service_unavailable(e: &keyring_core::Error) -> bool {
    match e {
        keyring_core::Error::PlatformFailure(inner) | keyring_core::Error::NoStorageAccess(inner) => {
            matches!(inner.downcast_ref::<secret_service::Error>(), Some(secret_service::Error::Unavailable))
        }
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn platform_store() -> Result<Arc<keyring_core::CredentialStore>, StoreError> {
    match windows_native_keyring_store::Store::new() {
        Ok(store) => Ok(store),
        Err(_) => Err(StoreError::Failed),
    }
}

/// Elsewhere there is no store, so setting a key fails with "keychain".
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn platform_store() -> Result<Arc<keyring_core::CredentialStore>, StoreError> {
    Err(StoreError::Failed)
}

/// Jev Mode's state for the web view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JevStatus {
    pub on: bool,
    pub has_key: bool,
    pub storage: Option<KeyStorage>,
    pub hint: Option<String>,
}

/// Jev's probabilities, keyed by the ask's own question ids.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Answers {
    pub answers: BTreeMap<String, f64>,
}

/// Jev Mode's native side, held in `AppState`.
pub struct Jev {
    store: Box<dyn KeyStore>,
    /// A key the keychain couldn't take, kept for this run only (KTD2).
    session: Mutex<Option<ApiKey>>,
}

impl Jev {
    pub fn new(store: Box<dyn KeyStore>) -> Self {
        Jev { store, session: Mutex::new(None) }
    }

    fn session(&self) -> MutexGuard<'_, Option<ApiKey>> {
        self.session.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Reads settings and memory, never the key store (KTD3).
    pub fn status(&self, file: &SettingsFile) -> JevStatus {
        self.status_of(&file.load().jev)
    }

    fn status_of(&self, jev: &JevSettings) -> JevStatus {
        let has_key = self.holds_key(jev);
        JevStatus {
            on: jev.on,
            has_key,
            storage: jev.storage.filter(|_| has_key),
            hint: jev.hint.clone().filter(|_| has_key),
        }
    }

    /// A session key counts only while memory holds it.
    fn holds_key(&self, jev: &JevSettings) -> bool {
        match jev.storage {
            Some(KeyStorage::Keychain) => true,
            Some(KeyStorage::Session) => self.session().is_some(),
            None => false,
        }
    }

    /// Stores the key, keychain first and settings second, and turns Jev Mode on.
    pub fn set_key(&self, file: &SettingsFile, raw: &str) -> Result<JevStatus, JevError> {
        let key = parse_key(raw)?;
        let hint = hint_for(&key);
        let jev = file.update(|s| {
            let storage = match self.store.write(&key) {
                Ok(()) => KeyStorage::Keychain,
                Err(StoreError::Unavailable) => KeyStorage::Session,
                Err(StoreError::Failed) => return Err(JevError::of(Kind::Keychain)),
            };
            s.jev = JevSettings { on: true, storage: Some(storage), hint };
            Ok(s.jev.clone())
        })?;
        *self.session() = (jev.storage == Some(KeyStorage::Session)).then_some(key);
        Ok(self.status_of(&jev))
    }

    /// Turns Jev Mode on or off. Turning it on needs a key; turning it off keeps it.
    pub fn set_on(&self, file: &SettingsFile, on: bool) -> Result<JevStatus, JevError> {
        let jev = file.update(|s| {
            if on && !self.holds_key(&s.jev) {
                return Err(JevError::of(Kind::KeyMissing));
            }
            s.jev.on = on;
            Ok(s.jev.clone())
        })?;
        Ok(self.status_of(&jev))
    }

    /// Deletes the key and turns Jev Mode off, but only once the delete succeeds.
    pub fn clear_key(&self, file: &SettingsFile) -> Result<JevStatus, JevError> {
        let jev = file.update(|s| {
            match self.store.delete() {
                Ok(()) => {}
                // With no Secret Service, a key that was never in the keychain is already gone.
                Err(StoreError::Unavailable) if s.jev.storage != Some(KeyStorage::Keychain) => {}
                Err(_) => return Err(JevError::of(Kind::Keychain)),
            }
            s.jev = JevSettings::default();
            Ok(s.jev.clone())
        })?;
        *self.session() = None;
        Ok(self.status_of(&jev))
    }

    /// Runs KTD1's checks in order (on, typed shape, budget) and only then reads
    /// the key, so a refused ask never raises a keychain prompt.
    pub fn prepare(&self, file: &SettingsFile, request: Value) -> Result<Prepared, JevError> {
        let jev = file.load().jev;
        if !jev.on {
            return Err(JevError::of(Kind::Off));
        }
        let ask = Ask::parse(request)?;
        ask.check_budget()?;
        let key = self.key_for_ask(file, &jev)?;
        Ok(Prepared { key, ask })
    }

    fn key_for_ask(&self, file: &SettingsFile, jev: &JevSettings) -> Result<ApiKey, JevError> {
        let found = match jev.storage {
            None => return Err(JevError::of(Kind::KeyMissing)),
            Some(KeyStorage::Session) => self.session().clone(),
            Some(KeyStorage::Keychain) => self.store.read().map_err(|_| JevError::of(Kind::Keychain))?,
        };
        found.ok_or_else(|| {
            // Settings follow the store, so status stops reporting a key that's gone.
            let _ = file.update(|s| {
                s.jev.storage = None;
                s.jev.hint = None;
                Ok::<_, UpdateError>(())
            });
            JevError::of(Kind::KeyMissing)
        })
    }
}

/// A checked ask and its key, ready to send.
#[derive(Debug)]
pub struct Prepared {
    key: ApiKey,
    ask: Ask,
}

/// The two shapes the web view may send. No field beyond these passes, so the
/// web view can write question wording but can't set the model or add to the body.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Ask {
    SecondOpinion(SecondOpinion),
    LineBreaks(LineBreaks),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SecondOpinion {
    state: OpinionState,
    questions: BTreeMap<String, Question<Instructions>>,
}

/// Only the reply, the badge's task and its rubric (R5).
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OpinionState {
    task: String,
    rubric_points: Vec<String>,
    rubric_notes: String,
    rubric: String,
    reply: String,
}

/// Only the pasted text (R5).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LineBreaks {
    state: String,
    questions: BTreeMap<String, Question<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Question<I> {
    #[serde(rename = "type")]
    kind: Noul,
    instructions: I,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    criteria: Option<Criteria>,
}

/// The only question type an ask may carry.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Noul {
    Noul,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum Instructions {
    Text(String),
    Structured(StructuredInstructions),
}

/// TypeSafe's structured instructions object, limited to what a point question needs.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StructuredInstructions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    point: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rubric_notes: Option<String>,
    question: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Criteria {
    #[serde(rename = "true")]
    yes: String,
    #[serde(rename = "false")]
    no: String,
}

impl Ask {
    /// Reads the web view's request into one of the two shapes, with its keys
    /// following the shape's rules.
    fn parse(request: Value) -> Result<Ask, JevError> {
        let malformed = JevError::of(Kind::Other);
        let ask: Ask = serde_json::from_value(request).map_err(|_| malformed)?;
        let keyed = match &ask {
            Ask::SecondOpinion(o) => {
                let expected: BTreeSet<String> = (1..=o.state.rubric_points.len())
                    .map(|i| format!("p{i}"))
                    .chain(["overall".to_string()])
                    .collect();
                o.questions.keys().cloned().collect::<BTreeSet<_>>() == expected
            }
            Ask::LineBreaks(l) => !l.questions.is_empty() && l.questions.keys().all(|id| is_line_id(id)),
        };
        if keyed {
            Ok(ask)
        } else {
            Err(malformed)
        }
    }

    /// The question cap and both token limits (KTD19).
    fn check_budget(&self) -> Result<(), JevError> {
        let (state, questions): (usize, Vec<usize>) = match self {
            Ask::SecondOpinion(o) => (tokens(&o.state), o.questions.values().map(tokens).collect()),
            Ask::LineBreaks(l) => (tokens(&l.state), l.questions.values().map(tokens).collect()),
        };
        let longest = questions.iter().copied().max().unwrap_or(0);
        let all = questions.iter().fold(0usize, |sum, t| sum.saturating_add(*t));
        let fits = questions.len() <= MAX_QUESTIONS
            && state.saturating_add(longest) <= STATE_PLUS_LONGEST_TOKENS
            && state.saturating_add(all) <= STATE_PLUS_ALL_TOKENS;
        if fits {
            Ok(())
        } else {
            Err(JevError::of(Kind::TooLong))
        }
    }

    fn ids(&self) -> BTreeSet<String> {
        match self {
            Ask::SecondOpinion(o) => o.questions.keys().cloned().collect(),
            Ask::LineBreaks(l) => l.questions.keys().cloned().collect(),
        }
    }

    /// The whole body TypeSafe receives: the state, the pinned model, the questions.
    fn body(&self) -> Value {
        let (state, questions) = match self {
            Ask::SecondOpinion(o) => (serde_json::json!(o.state), serde_json::json!(o.questions)),
            Ask::LineBreaks(l) => (serde_json::json!(l.state), serde_json::json!(l.questions)),
        };
        serde_json::json!({ "state": state, "model": MODEL, "questions": questions })
    }
}

/// "L" and one to six digits, as the cleanup tags its lines.
fn is_line_id(id: &str) -> bool {
    id.strip_prefix('L')
        .is_some_and(|digits| (1..=6).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()))
}

/// The token estimate: characters of compact JSON over four, rounded up (KTD19).
fn tokens(value: &impl Serialize) -> usize {
    serde_json::to_string(value).map_or(usize::MAX, |json| json.chars().count().div_ceil(4))
}

/// HTTPS only, no redirects, a 20-second limit, and TLS checked against the OS
/// trust store. reqwest is built without its cookie store, so none is kept.
fn client() -> Result<reqwest::Client, JevError> {
    reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .build()
        .map_err(|_| JevError::of(Kind::Other))
}

/// The one request Jev Mode sends: the fixed endpoint, with the key in a bearer
/// header marked sensitive so it prints as "Sensitive".
fn build_request(client: &reqwest::Client, key: &ApiKey, body: &Value) -> Result<reqwest::Request, JevError> {
    let malformed = JevError::of(Kind::Other);
    let bearer = Zeroizing::new(format!("Bearer {}", key.expose()));
    let mut auth = HeaderValue::from_str(&bearer).map_err(|_| malformed)?;
    auth.set_sensitive(true);
    client.post(ENDPOINT).header(AUTHORIZATION, auth).json(body).build().map_err(|_| malformed)
}

/// What went wrong on the way to an answer, before it becomes a kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Failure {
    /// A response that isn't a success, with its Retry-After seconds if any.
    Status(u16, Option<u32>),
    TimedOut,
    NoConnection,
    /// Any other failure inside the HTTP library.
    Transport,
}

/// Maps a failure to its kind (KTD20).
fn kind_of(failure: Failure) -> JevError {
    let waiting = |kind, retry_after| JevError { kind, status: None, retry_after };
    match failure {
        Failure::Status(401, _) => JevError::of(Kind::KeyRefused),
        Failure::Status(413, _) => JevError::of(Kind::TooLong),
        Failure::Status(429, retry) => waiting(Kind::RateLimited, retry),
        Failure::Status(529, retry) => waiting(Kind::Overloaded, retry),
        // Redirects land here too: the client never follows one.
        Failure::Status(status, _) => JevError { kind: Kind::Other, status: Some(status), retry_after: None },
        Failure::TimedOut | Failure::NoConnection => JevError::of(Kind::Unreachable),
        Failure::Transport => JevError::of(Kind::Other),
    }
}

fn failure_of(err: &reqwest::Error) -> Failure {
    if err.is_timeout() {
        Failure::TimedOut
    } else if err.is_connect() {
        Failure::NoConnection
    } else {
        Failure::Transport
    }
}

/// Retry-After in whole seconds. The date form is ignored.
fn retry_after(headers: &HeaderMap) -> Option<u32> {
    headers.get(RETRY_AFTER)?.to_str().ok()?.trim().parse().ok()
}

/// TypeSafe's reply as far as Jev Mode reads it. Other fields are ignored.
#[derive(Deserialize)]
struct WireReply {
    answers: BTreeMap<String, WireAnswer>,
}

#[derive(Deserialize)]
struct WireAnswer {
    #[serde(rename = "type")]
    kind: String,
    noul: Option<f64>,
}

/// Turns TypeSafe's reply into probabilities keyed by the ask's own ids. A status
/// that isn't a success never reads the body. An answer outside 0–1, of another
/// type, missing, or for an id the ask didn't send is "other", never clamped.
fn answers_from(status: u16, headers: &HeaderMap, body: &[u8], ids: &BTreeSet<String>) -> Result<Answers, JevError> {
    if !(200..300).contains(&status) {
        return Err(kind_of(Failure::Status(status, retry_after(headers))));
    }
    let malformed = JevError::of(Kind::Other);
    let reply: WireReply = serde_json::from_slice(body).map_err(|_| malformed)?;
    if reply.answers.len() != ids.len() {
        return Err(malformed);
    }
    let mut answers = BTreeMap::new();
    for (id, answer) in reply.answers {
        match answer.noul {
            Some(p) if ids.contains(&id) && answer.kind == "noul" && (0.0..=1.0).contains(&p) => {
                answers.insert(id, p);
            }
            _ => return Err(malformed),
        }
    }
    Ok(Answers { answers })
}

/// Sends a prepared ask and returns Jev's probabilities.
pub async fn send(prepared: Prepared) -> Result<Answers, JevError> {
    let Prepared { key, ask } = prepared;
    let client = client()?;
    let request = build_request(&client, &key, &ask.body())?;
    drop(key);
    let mut response = client.execute(request).await.map_err(|e| kind_of(failure_of(&e)))?;
    let status = response.status().as_u16();
    let body = if response.status().is_success() {
        read_capped(&mut response).await?
    } else {
        Vec::new()
    };
    answers_from(status, response.headers(), &body, &ask.ids())
}

/// Reads a success body up to the cap; a longer one is "other".
async fn read_capped(response: &mut reqwest::Response) -> Result<Vec<u8>, JevError> {
    let too_long = JevError::of(Kind::Other);
    if response.content_length().is_some_and(|n| n > MAX_RESPONSE_BYTES as u64) {
        return Err(too_long);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| kind_of(failure_of(&e)))? {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(too_long);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{self, Settings};
    use keyring_core::api::CredentialStoreApi;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const KEY: &str = "ts-live-0123456789abcdef";

    /// A key store in memory that counts what is asked of it, can be told to
    /// fail, and can record the settings file as it stood at each write.
    #[derive(Default)]
    struct MemoryStore {
        key: Mutex<Option<String>>,
        reads: AtomicUsize,
        writes: AtomicUsize,
        deletes: AtomicUsize,
        fail_read: Option<StoreError>,
        fail_write: Option<StoreError>,
        fail_delete: Option<StoreError>,
        watch: Option<PathBuf>,
        settings_at_write: Mutex<Option<Settings>>,
    }

    impl MemoryStore {
        fn holding(key: &str) -> Self {
            MemoryStore { key: Mutex::new(Some(key.to_string())), ..Default::default() }
        }
        fn reads(&self) -> usize {
            self.reads.load(Ordering::SeqCst)
        }
        fn writes(&self) -> usize {
            self.writes.load(Ordering::SeqCst)
        }
        fn deletes(&self) -> usize {
            self.deletes.load(Ordering::SeqCst)
        }
        fn held(&self) -> Option<String> {
            self.key.lock().unwrap().clone()
        }
    }

    impl KeyStore for Arc<MemoryStore> {
        fn read(&self) -> Result<Option<ApiKey>, StoreError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if let Some(e) = self.fail_read {
                return Err(e);
            }
            Ok(self.held().map(ApiKey))
        }
        fn write(&self, key: &ApiKey) -> Result<(), StoreError> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            if let Some(path) = &self.watch {
                *self.settings_at_write.lock().unwrap() = Some(settings::load(path));
            }
            if let Some(e) = self.fail_write {
                return Err(e);
            }
            *self.key.lock().unwrap() = Some(key.expose().to_string());
            Ok(())
        }
        fn delete(&self) -> Result<(), StoreError> {
            self.deletes.fetch_add(1, Ordering::SeqCst);
            if let Some(e) = self.fail_delete {
                return Err(e);
            }
            *self.key.lock().unwrap() = None;
            Ok(())
        }
    }

    struct Rig {
        _dir: tempfile::TempDir,
        file: SettingsFile,
        store: Arc<MemoryStore>,
        jev: Jev,
    }

    fn rig_with(store: MemoryStore) -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let file = SettingsFile::new(dir.path().join(settings::FILE_NAME));
        let store = Arc::new(store);
        let jev = Jev::new(Box::new(store.clone()));
        Rig { _dir: dir, file, store, jev }
    }

    fn rig() -> Rig {
        rig_with(MemoryStore::default())
    }

    /// A rig whose settings say Jev Mode is on with a key in the keychain.
    fn rig_on() -> Rig {
        let r = rig_with(MemoryStore::holding(KEY));
        save_jev(&r.file, JevSettings { on: true, storage: Some(KeyStorage::Keychain), hint: Some("cdef".into()) });
        r
    }

    fn save_jev(file: &SettingsFile, jev: JevSettings) {
        let mut s = file.load();
        s.jev = jev;
        settings::save(&file.path, &s).unwrap();
    }

    fn criteria() -> Value {
        json!({ "true": "the reply names the files", "false": "the reply only asserts it" })
    }

    fn opinion(points: usize) -> Value {
        let rubric_points: Vec<String> = (1..=points).map(|i| format!("Point {i}")).collect();
        let mut questions = serde_json::Map::new();
        for i in 1..=points {
            questions.insert(
                format!("p{i}"),
                json!({
                    "type": "noul",
                    "instructions": {
                        "point": format!("Point {i}"),
                        "rubric_notes": "A rewrite in other words passes.",
                        "question": "Does `reply` satisfy `point`, read with `rubric_notes`, given `task`?"
                    },
                    "criteria": criteria()
                }),
            );
        }
        questions.insert(
            "overall".into(),
            json!({ "type": "noul", "instructions": "Does `reply` satisfy all of `rubric`, given `task`?", "criteria": criteria() }),
        );
        json!({
            "kind": "secondOpinion",
            "state": {
                "task": "Write the README",
                "rubric_points": rubric_points,
                "rubric_notes": "A rewrite in other words passes.",
                "rubric": "- Point 1\n- Point 2",
                "reply": "Done. I wrote README.md with an install section."
            },
            "questions": questions
        })
    }

    fn line_breaks(ids: &[&str]) -> Value {
        let questions: serde_json::Map<String, Value> = ids
            .iter()
            .map(|id| {
                (
                    id.to_string(),
                    json!({ "type": "noul", "instructions": format!("Does line {id} pick up mid-sentence?"), "criteria": criteria() }),
                )
            })
            .collect();
        json!({ "kind": "lineBreaks", "state": "L001| The cutover touches\nL002| three teams.", "questions": questions })
    }

    fn ids(list: &[&str]) -> BTreeSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn kind(r: Result<impl std::fmt::Debug, JevError>) -> Kind {
        r.expect_err("expected an error").kind
    }

    // Transport

    #[test]
    fn a_built_request_targets_the_fixed_endpoint_with_a_sensitive_bearer_and_the_pinned_model() {
        let ask = Ask::parse(opinion(2)).unwrap();
        let request = build_request(&client().unwrap(), &parse_key(KEY).unwrap(), &ask.body()).unwrap();

        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(request.url().as_str(), "https://api.typesafe.ai/v1/systemone");
        let auth = request.headers().get(AUTHORIZATION).unwrap();
        assert!(auth.is_sensitive());
        assert_eq!(auth.to_str().unwrap(), format!("Bearer {KEY}"));

        let body: Value = serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["model"], "jev-1.13.0");
        let fields: BTreeSet<&str> = body.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        assert_eq!(fields, BTreeSet::from(["model", "questions", "state"]));
        assert_eq!(body["state"]["reply"], "Done. I wrote README.md with an install section.");
        assert_eq!(body["questions"]["p1"]["type"], "noul");
        assert_eq!(body["questions"]["p1"]["instructions"]["point"], "Point 1");
        assert_eq!(body["questions"]["overall"]["criteria"]["false"], "the reply only asserts it");
    }

    #[test]
    fn a_built_requests_debug_output_hides_the_key() {
        let ask = Ask::parse(line_breaks(&["L002"])).unwrap();
        let request = build_request(&client().unwrap(), &parse_key(KEY).unwrap(), &ask.body()).unwrap();
        let printed = format!("{request:?}");
        assert!(printed.contains("api.typesafe.ai"), "the debug output is the request's: {printed}");
        assert!(!printed.contains(KEY));
    }

    #[test]
    fn statuses_and_transport_failures_map_to_their_kinds() {
        let status = |code| kind_of(Failure::Status(code, None));
        assert_eq!(status(401), JevError::of(Kind::KeyRefused));
        assert_eq!(status(429).kind, Kind::RateLimited);
        assert_eq!(status(529).kind, Kind::Overloaded);
        assert_eq!(status(413), JevError::of(Kind::TooLong));
        assert_eq!(status(422), JevError { kind: Kind::Other, status: Some(422), retry_after: None });
        assert_eq!(status(500), JevError { kind: Kind::Other, status: Some(500), retry_after: None });
        for redirect in [301, 302, 307, 308] {
            assert_eq!(status(redirect), JevError { kind: Kind::Other, status: Some(redirect), retry_after: None });
        }
        assert_eq!(kind_of(Failure::TimedOut), JevError::of(Kind::Unreachable));
        assert_eq!(kind_of(Failure::NoConnection), JevError::of(Kind::Unreachable));
        assert_eq!(kind_of(Failure::Transport), JevError::of(Kind::Other));
    }

    #[test]
    fn a_retry_after_header_comes_back_as_seconds_for_429_and_529_only() {
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, HeaderValue::from_static("7"));
        let none = ids(&["L002"]);
        let limited = answers_from(429, &headers, b"", &none).unwrap_err();
        assert_eq!(limited, JevError { kind: Kind::RateLimited, status: None, retry_after: Some(7) });
        assert_eq!(answers_from(529, &headers, b"", &none).unwrap_err().retry_after, Some(7));
        assert_eq!(answers_from(500, &headers, b"", &none).unwrap_err().retry_after, None);

        headers.insert(RETRY_AFTER, HeaderValue::from_static("Wed, 21 Oct 2026 07:28:00 GMT"));
        assert_eq!(answers_from(429, &headers, b"", &none).unwrap_err().retry_after, None);
    }

    #[test]
    fn a_refused_reply_never_carries_its_body_into_the_error() {
        let body = format!(r#"{{"detail":"invalid key {KEY}","state":"Done. I wrote README.md"}}"#);
        for code in [401, 422] {
            let err = answers_from(code, &HeaderMap::new(), body.as_bytes(), &ids(&["overall"])).unwrap_err();
            let sent = serde_json::to_string(&err).unwrap();
            assert!(!sent.contains(KEY), "{sent}");
            assert!(!sent.contains("README"), "{sent}");
        }
    }

    #[test]
    fn answers_are_keyed_by_the_asks_own_ids() {
        let body = br#"{
            "model": "jev-1.13.0",
            "answers": {
                "p1": { "type": "noul", "noul": 0.92 },
                "overall": { "type": "noul", "noul": 0 }
            },
            "usage": { "input_tokens": 310, "output_tokens": 20 }
        }"#;
        let answers = answers_from(200, &HeaderMap::new(), body, &ids(&["p1", "overall"])).unwrap();
        assert_eq!(answers.answers, BTreeMap::from([("overall".to_string(), 0.0), ("p1".to_string(), 0.92)]));
        assert_eq!(serde_json::to_value(&answers).unwrap(), json!({ "answers": { "overall": 0.0, "p1": 0.92 } }));
    }

    #[test]
    fn an_answer_outside_zero_to_one_or_for_an_unknown_id_is_other() {
        let asked = ids(&["p1"]);
        let other = |body: &str| answers_from(200, &HeaderMap::new(), body.as_bytes(), &asked).unwrap_err();
        let malformed = JevError::of(Kind::Other);
        assert_eq!(other(r#"{"answers":{"p1":{"type":"noul","noul":1.01}}}"#), malformed);
        assert_eq!(other(r#"{"answers":{"p1":{"type":"noul","noul":-0.01}}}"#), malformed);
        assert_eq!(other(r#"{"answers":{"p1":{"type":"noul","noul":0.5},"p9":{"type":"noul","noul":0.5}}}"#), malformed);
        assert_eq!(other(r#"{"answers":{"p9":{"type":"noul","noul":0.5}}}"#), malformed);
        assert_eq!(other(r#"{"answers":{}}"#), malformed);
        assert_eq!(other(r#"{"answers":{"p1":{"type":"choice","choice":"yes"}}}"#), malformed);
        assert_eq!(other(r#"{"answers":{"p1":{"type":"noul"}}}"#), malformed);
        assert_eq!(other("<html>Moved</html>"), malformed);
    }

    #[test]
    fn status_and_errors_reach_the_web_view_in_the_contracts_shape() {
        let status = JevStatus { on: true, has_key: true, storage: Some(KeyStorage::Session), hint: Some("cdef".into()) };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            json!({ "on": true, "hasKey": true, "storage": "session", "hint": "cdef" })
        );
        let none = JevStatus { on: false, has_key: false, storage: None, hint: None };
        assert_eq!(
            serde_json::to_value(&none).unwrap(),
            json!({ "on": false, "hasKey": false, "storage": null, "hint": null })
        );
        let keychain = JevStatus { storage: Some(KeyStorage::Keychain), ..status };
        assert_eq!(serde_json::to_value(&keychain).unwrap()["storage"], "keychain");

        let limited = JevError { kind: Kind::RateLimited, status: None, retry_after: Some(7) };
        assert_eq!(
            serde_json::to_value(limited).unwrap(),
            json!({ "kind": "rateLimited", "status": null, "retryAfter": 7 })
        );
        let kinds = [
            (Kind::Off, "off"),
            (Kind::KeyMissing, "keyMissing"),
            (Kind::KeyRefused, "keyRefused"),
            (Kind::RateLimited, "rateLimited"),
            (Kind::Overloaded, "overloaded"),
            (Kind::TooLong, "tooLong"),
            (Kind::Unreachable, "unreachable"),
            (Kind::Other, "other"),
            (Kind::Keychain, "keychain"),
            (Kind::InvalidKey, "invalidKey"),
            (Kind::Settings, "settings"),
        ];
        for (kind, name) in kinds {
            assert_eq!(serde_json::to_value(JevError::of(kind)).unwrap()["kind"], name);
        }
        assert_eq!(
            serde_json::to_value(JevError { kind: Kind::Other, status: Some(422), retry_after: None }).unwrap(),
            json!({ "kind": "other", "status": 422, "retryAfter": null })
        );
    }

    // Asks

    #[test]
    fn an_ask_with_jev_mode_off_is_refused_before_any_store_read() {
        let r = rig_with(MemoryStore::holding(KEY));
        save_jev(&r.file, JevSettings { on: false, storage: Some(KeyStorage::Keychain), hint: None });
        assert_eq!(kind(r.jev.prepare(&r.file, opinion(2))), Kind::Off);
        assert_eq!(r.store.reads(), 0);

        // A file that can't be read counts as off.
        std::fs::write(&r.file.path, "{ not json").unwrap();
        assert_eq!(kind(r.jev.prepare(&r.file, opinion(2))), Kind::Off);
        assert_eq!(r.store.reads(), 0);
    }

    #[test]
    fn malformed_asks_are_refused_before_the_key_read() {
        let r = rig_on();
        let mut with_model = opinion(1);
        with_model["model"] = json!("jev-latest");
        let mut extra_top = opinion(1);
        extra_top["machine"] = json!("Studio");
        let mut extra_state = opinion(1);
        extra_state["state"]["agent"] = json!({ "harness": "claude" });
        let mut extra_question = opinion(1);
        extra_question["questions"]["p1"]["weight"] = json!(2);
        let mut extra_instructions = opinion(1);
        extra_instructions["questions"]["p1"]["instructions"]["memory"] = json!("x");
        let mut choice = opinion(1);
        choice["questions"]["p1"]["type"] = json!("choice");
        let mut no_type = opinion(1);
        no_type["questions"]["p1"].as_object_mut().unwrap().remove("type");
        let mut missing_point = opinion(2);
        missing_point["questions"].as_object_mut().unwrap().remove("p2");
        let mut extra_point = opinion(1);
        extra_point["questions"]["p2"] = extra_point["questions"]["p1"].clone();
        let mut no_overall = opinion(1);
        no_overall["questions"].as_object_mut().unwrap().remove("overall");
        let mut structured_line = line_breaks(&["L002"]);
        structured_line["questions"]["L002"]["instructions"] = json!({ "question": "Joined?" });
        let mut object_state = line_breaks(&["L002"]);
        object_state["state"] = json!({ "text": "L001| a" });
        let mut unknown_kind = line_breaks(&["L002"]);
        unknown_kind["kind"] = json!("rewrite");

        let refused = [
            ("a model field", with_model),
            ("an unknown top-level field", extra_top),
            ("an unknown state field", extra_state),
            ("an unknown question field", extra_question),
            ("an unknown instructions field", extra_instructions),
            ("a non-Noul question", choice),
            ("a question with no type", no_type),
            ("a point with no question", missing_point),
            ("a question for no point", extra_point),
            ("no overall question", no_overall),
            ("structured instructions in a cleanup", structured_line),
            ("a cleanup state that isn't text", object_state),
            ("an unknown kind", unknown_kind),
            ("a line id that isn't one", line_breaks(&["L002", "line3"])),
            ("a line id that's too long", line_breaks(&["L1234567"])),
            ("a cleanup with no questions", line_breaks(&[])),
            ("not an object", json!("ask")),
        ];
        for (what, request) in refused {
            assert_eq!(kind(r.jev.prepare(&r.file, request)), Kind::Other, "{what}");
        }
        assert_eq!(r.store.reads(), 0);
    }

    #[test]
    fn over_budget_asks_are_refused_before_the_key_read() {
        let r = rig_on();
        let many: Vec<String> = (2..=MAX_QUESTIONS + 2).map(|i| format!("L{i:03}")).collect();
        let many: Vec<&str> = many.iter().map(|s| s.as_str()).collect();
        assert_eq!(kind(r.jev.prepare(&r.file, line_breaks(&many))), Kind::TooLong, "too many questions");
        assert_eq!(kind(r.jev.prepare(&r.file, opinion(MAX_QUESTIONS))), Kind::TooLong, "too many points");

        // State plus the longest question over 32k tokens (128k characters).
        let mut long_reply = opinion(1);
        long_reply["state"]["reply"] = json!("x".repeat(4 * STATE_PLUS_LONGEST_TOKENS));
        assert_eq!(kind(r.jev.prepare(&r.file, long_reply)), Kind::TooLong, "state plus longest");

        // Each question fits beside the state, but all of them don't fit in 64k.
        let five = ["L002", "L003", "L004", "L005", "L006"];
        let mut wide = line_breaks(&five);
        wide["state"] = json!("y".repeat(4 * 20_000));
        for id in five {
            wide["questions"][id]["instructions"] = json!("z".repeat(4 * 11_000));
        }
        assert_eq!(kind(r.jev.prepare(&r.file, wide)), Kind::TooLong, "state plus all");
        assert_eq!(r.store.reads(), 0);

        // Under both limits, the key is read and the ask goes ahead.
        let mut fits = line_breaks(&["L002", "L003"]);
        fits["state"] = json!("y".repeat(4 * 20_000));
        for id in ["L002", "L003"] {
            fits["questions"][id]["instructions"] = json!("z".repeat(4 * 11_000));
        }
        assert!(r.jev.prepare(&r.file, fits).is_ok());
        assert_eq!(r.store.reads(), 1);
    }

    #[test]
    fn a_prepared_ask_reads_the_key_once_and_sends_only_state_model_and_questions() {
        let r = rig_on();
        let prepared = r.jev.prepare(&r.file, opinion(2)).unwrap();
        assert_eq!(r.store.reads(), 1);
        assert_eq!(prepared.key.expose(), KEY);
        assert_eq!(prepared.ask.ids(), ids(&["overall", "p1", "p2"]));
        let body = prepared.ask.body();
        assert_eq!(body["model"], MODEL);
        assert_eq!(body["state"]["rubric_points"], json!(["Point 1", "Point 2"]));
        assert_eq!(body["state"]["rubric_notes"], "A rewrite in other words passes.");
    }

    #[test]
    fn an_ask_with_no_key_in_the_store_is_key_missing_and_settings_follow() {
        let r = rig();
        save_jev(&r.file, JevSettings { on: true, storage: Some(KeyStorage::Keychain), hint: Some("cdef".into()) });
        assert_eq!(kind(r.jev.prepare(&r.file, opinion(1))), Kind::KeyMissing);
        assert_eq!(r.store.reads(), 1);
        assert_eq!(r.file.load().jev, JevSettings { on: true, storage: None, hint: None });
        assert!(!r.jev.status(&r.file).has_key);

        // Settings now say there is no key, so the next ask doesn't look.
        assert_eq!(kind(r.jev.prepare(&r.file, opinion(1))), Kind::KeyMissing);
        assert_eq!(r.store.reads(), 1);
    }

    #[test]
    fn a_failing_store_read_is_a_keychain_error() {
        let r = rig_with(MemoryStore { fail_read: Some(StoreError::Failed), ..MemoryStore::holding(KEY) });
        save_jev(&r.file, JevSettings { on: true, storage: Some(KeyStorage::Keychain), hint: None });
        assert_eq!(kind(r.jev.prepare(&r.file, opinion(1))), Kind::Keychain);
        assert_eq!(r.file.load().jev.storage, Some(KeyStorage::Keychain), "a refused read isn't a missing key");
    }

    // Keys

    #[test]
    fn setting_a_key_writes_the_store_before_the_settings_and_turns_jev_mode_on() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(settings::FILE_NAME);
        let r = rig_with(MemoryStore { watch: Some(path.clone()), ..Default::default() });
        let file = SettingsFile::new(path);

        let status = r.jev.set_key(&file, &format!("  {KEY}\n")).unwrap();

        assert_eq!(r.store.held().as_deref(), Some(KEY), "trimmed");
        let at_write = r.store.settings_at_write.lock().unwrap().clone().unwrap();
        assert_eq!(at_write.jev, JevSettings::default(), "the store was written before the settings");
        assert_eq!(file.load().jev, JevSettings { on: true, storage: Some(KeyStorage::Keychain), hint: Some("cdef".into()) });
        assert_eq!(
            status,
            JevStatus { on: true, has_key: true, storage: Some(KeyStorage::Keychain), hint: Some("cdef".into()) }
        );
        assert!(!std::fs::read_to_string(&file.path).unwrap().contains(KEY), "the key never reaches settings");
    }

    #[test]
    fn a_failing_store_write_leaves_settings_unchanged_and_jev_mode_off() {
        let r = rig_with(MemoryStore { fail_write: Some(StoreError::Failed), ..Default::default() });
        r.file.remember_data_folder("/data").unwrap();
        let before = std::fs::read_to_string(&r.file.path).unwrap();

        assert_eq!(kind(r.jev.set_key(&r.file, KEY)), Kind::Keychain);
        assert_eq!(std::fs::read_to_string(&r.file.path).unwrap(), before);
        let status = r.jev.status(&r.file);
        assert!(!status.on && !status.has_key);
    }

    #[test]
    fn keys_with_line_breaks_non_ascii_or_too_long_are_refused_at_set_time() {
        let r = rig();
        let refused = [
            "ts-live-0123\n456789".to_string(),
            "ts-live-0123\r456789".to_string(),
            "ts-live-0123456789é".to_string(),
            "ts-live-\u{200b}0123456789".to_string(),
            "ts\tlive".to_string(),
            "x".repeat(MAX_KEY_CHARS + 1),
            "   ".to_string(),
            String::new(),
        ];
        for key in &refused {
            assert_eq!(kind(r.jev.set_key(&r.file, key)), Kind::InvalidKey, "{key:?}");
        }
        assert_eq!(r.store.writes(), 0, "a refused key never reaches the store");
        assert!(!r.file.path.exists(), "nor the settings");

        assert!(r.jev.set_key(&r.file, &"x".repeat(MAX_KEY_CHARS)).is_ok());
    }

    #[test]
    fn keys_under_twelve_characters_get_no_hint() {
        let r = rig();
        assert_eq!(r.jev.set_key(&r.file, "abcdefghijk").unwrap().hint, None);
        assert_eq!(r.file.load().jev.hint, None);
        assert_eq!(r.jev.set_key(&r.file, "abcdefghijkl").unwrap().hint.as_deref(), Some("ijkl"));
    }

    #[test]
    fn the_key_prints_as_a_placeholder() {
        let key = parse_key(KEY).unwrap();
        assert!(!format!("{key:?}").contains(KEY));
        assert!(!format!("{key}").contains(KEY));
    }

    #[test]
    fn only_an_unavailable_store_keeps_the_key_for_the_session() {
        let r = rig_with(MemoryStore { fail_write: Some(StoreError::Unavailable), ..Default::default() });
        let status = r.jev.set_key(&r.file, KEY).unwrap();
        assert_eq!(status, JevStatus { on: true, has_key: true, storage: Some(KeyStorage::Session), hint: Some("cdef".into()) });

        // The ask uses the key from memory, without a store read.
        let prepared = r.jev.prepare(&r.file, opinion(1)).unwrap();
        assert_eq!(prepared.key.expose(), KEY);
        assert_eq!(r.store.reads(), 0);

        // After a relaunch, memory is empty, so there is no key.
        let relaunched = Jev::new(Box::new(r.store.clone()));
        let status = relaunched.status(&r.file);
        assert!(status.on && !status.has_key);
        assert_eq!(status.storage, None);
        assert_eq!(kind(relaunched.prepare(&r.file, opinion(1))), Kind::KeyMissing);
        assert_eq!(r.store.reads(), 0);

        // Any other store error doesn't fall back.
        let failing = rig_with(MemoryStore { fail_write: Some(StoreError::Failed), ..Default::default() });
        assert_eq!(kind(failing.jev.set_key(&failing.file, KEY)), Kind::Keychain);
        assert_eq!(failing.file.load().jev, JevSettings::default());
        assert!(!failing.jev.status(&failing.file).has_key);
    }

    #[test]
    fn status_never_reads_the_store() {
        let r = rig_on();
        assert_eq!(
            r.jev.status(&r.file),
            JevStatus { on: true, has_key: true, storage: Some(KeyStorage::Keychain), hint: Some("cdef".into()) }
        );
        save_jev(&r.file, JevSettings { on: true, storage: Some(KeyStorage::Session), hint: Some("cdef".into()) });
        assert_eq!(r.jev.status(&r.file), JevStatus { on: true, has_key: false, storage: None, hint: None });
        assert_eq!(r.jev.status(&rig().file), JevStatus { on: false, has_key: false, storage: None, hint: None });
        assert_eq!(r.store.reads(), 0);
    }

    #[test]
    fn turning_on_needs_a_key_and_turning_off_keeps_it() {
        let r = rig();
        assert_eq!(kind(r.jev.set_on(&r.file, true)), Kind::KeyMissing);
        assert!(!r.file.load().jev.on);

        r.jev.set_key(&r.file, KEY).unwrap();
        let off = r.jev.set_on(&r.file, false).unwrap();
        assert!(!off.on && off.has_key);
        assert_eq!(r.store.held().as_deref(), Some(KEY));
        assert!(r.jev.set_on(&r.file, true).unwrap().on);
        assert_eq!(r.store.reads() + r.store.deletes(), 0, "the switch never touches the store");
    }

    #[test]
    fn clearing_the_key_deletes_it_and_turns_jev_mode_off() {
        let r = rig_on();
        let status = r.jev.clear_key(&r.file).unwrap();
        assert_eq!(status, JevStatus { on: false, has_key: false, storage: None, hint: None });
        assert_eq!(r.store.held(), None);
        assert_eq!(r.file.load().jev, JevSettings::default());
    }

    #[test]
    fn clearing_a_session_key_forgets_it_without_a_keychain() {
        let r = rig_with(MemoryStore {
            fail_write: Some(StoreError::Unavailable),
            fail_delete: Some(StoreError::Unavailable),
            ..Default::default()
        });
        r.jev.set_key(&r.file, KEY).unwrap();
        let status = r.jev.clear_key(&r.file).unwrap();
        assert!(!status.on && !status.has_key);
        assert!(r.jev.session().is_none());
    }

    #[test]
    fn a_failed_delete_reports_failure_and_keeps_the_settings() {
        for error in [StoreError::Failed, StoreError::Unavailable] {
            let r = rig_with(MemoryStore { fail_delete: Some(error), ..MemoryStore::holding(KEY) });
            save_jev(&r.file, JevSettings { on: true, storage: Some(KeyStorage::Keychain), hint: Some("cdef".into()) });
            let before = std::fs::read_to_string(&r.file.path).unwrap();

            assert_eq!(kind(r.jev.clear_key(&r.file)), Kind::Keychain);
            assert_eq!(std::fs::read_to_string(&r.file.path).unwrap(), before);
            assert!(r.jev.status(&r.file).has_key);
        }
    }

    #[test]
    fn an_unparseable_settings_file_is_never_written_by_jev_mode() {
        let r = rig_with(MemoryStore::holding(KEY));
        std::fs::write(&r.file.path, "{ not json").unwrap();

        assert_eq!(kind(r.jev.set_on(&r.file, true)), Kind::Settings);
        assert_eq!(kind(r.jev.set_on(&r.file, false)), Kind::Settings);
        assert_eq!(kind(r.jev.set_key(&r.file, KEY)), Kind::Settings);
        assert_eq!(kind(r.jev.clear_key(&r.file)), Kind::Settings);
        assert_eq!(std::fs::read_to_string(&r.file.path).unwrap(), "{ not json");
        assert_eq!(r.store.writes() + r.store.deletes() + r.store.reads(), 0, "nor does it reach the store");
    }

    #[test]
    fn a_new_key_overwrites_the_same_keychain_entry() {
        let r = rig();
        r.jev.set_key(&r.file, KEY).unwrap();
        r.jev.set_key(&r.file, "ts-live-ffffffffffff9999").unwrap();
        assert_eq!(r.store.held().as_deref(), Some("ts-live-ffffffffffff9999"));
        assert_eq!(r.jev.status(&r.file).hint.as_deref(), Some("9999"));

        // Through keyring-core, against its in-memory mock store, never the real keychain.
        let mock = keyring_core::mock::Store::new().unwrap();
        let keychain = Keychain { store: Ok(mock.clone()) };
        assert!(keychain.read().unwrap().is_none());
        keychain.write(&parse_key(KEY).unwrap()).unwrap();
        keychain.write(&parse_key("ts-live-ffffffffffff9999").unwrap()).unwrap();
        assert_eq!(keychain.read().unwrap().unwrap().expose(), "ts-live-ffffffffffff9999");
        let entries = mock.search(&std::collections::HashMap::from([("service", KEYCHAIN_SERVICE)])).unwrap();
        assert_eq!(entries.len(), 1, "one entry, overwritten");
        keychain.delete().unwrap();
        assert!(keychain.read().unwrap().is_none());
        keychain.delete().expect("deleting a key that isn't there succeeds");
    }

    #[test]
    fn a_keychain_that_could_not_open_reports_its_error() {
        let unavailable = Keychain { store: Err(StoreError::Unavailable) };
        assert_eq!(unavailable.write(&parse_key(KEY).unwrap()), Err(StoreError::Unavailable));
        let failed = Keychain { store: Err(StoreError::Failed) };
        assert_eq!(failed.read().unwrap_err(), StoreError::Failed);
        assert_eq!(failed.delete(), Err(StoreError::Failed));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn only_the_secret_service_unavailable_error_counts_as_unavailable() {
        let wrap = |e: secret_service::Error| keyring_core::Error::PlatformFailure(Box::new(e));
        assert!(secret_service_unavailable(&wrap(secret_service::Error::Unavailable)));
        assert!(!secret_service_unavailable(&wrap(secret_service::Error::Locked)));
        assert!(!secret_service_unavailable(&wrap(secret_service::Error::Prompt)));
        assert!(!secret_service_unavailable(&keyring_core::Error::NoEntry));
    }
}
