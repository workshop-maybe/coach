//! Jev Mode: a second opinion, a head-to-head, a line-break cleanup and a routing ask
//! from TypeSafe's Jev model, sent with the user's own API key (KTD1–KTD4, KTD19, KTD20;
//! jev-in-compare KTD5; router KTD1, KTD3, KTD7). The key lives in the OS keychain,
//! status reads only `settings.json` and memory, and an ask is checked before any key
//! store is read, so a bad call never raises a prompt.
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
//! | `jev_ask`       | `{ request: JevRequest }`  | `JevAnswers`| `off`, `other`, `tooLong`, `keyMissing`, `keychain`, `keyRefused`, `invalidRequest`, `rateLimited`, `overloaded`, `unreachable` |
//!
//! `jev_status` never reads the key store. `jev_set_key` trims the key, makes no
//! network call, writes the keychain and then the settings, and turns Jev Mode on.
//! Where Linux has no Secret Service it keeps the key in memory for this run and
//! reports `storage: "session"`. `jev_clear_key` deletes the key and turns Jev
//! Mode off, and changes nothing unless the delete succeeds. `jev_set_on` with
//! `false` keeps the key. `jev_ask` checks, in order, that Jev Mode is on, that the
//! request is one of the four shapes below with no other field, and that it fits
//! the budget, examples included; only then does it read the key and post. It is
//! never retried here.
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
//!   | "invalidRequest" // TypeSafe answered 422: the request failed its validation, a bug in the app
//!   | "rateLimited" // 429
//!   | "overloaded"  // 529
//!   | "tooLong"     // over the question cap or token budget (refused before sending), or 413
//!   | "unreachable" // no connection, or no complete answer within 20 seconds
//!   | "other"       // any other status, a redirect, a malformed request caught before sending, or a malformed answer
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
//! // One example on a criteria side (growing context KTD2, KTD10): the opening of an
//! // earlier reply on the badge, and the user's note on it. `reply_opening` is 1 to 300
//! // characters; `user_reason` is at most 200 characters and holds no line break
//! // (U+000A, U+000B, U+000C, U+000D, U+0085, U+2028, U+2029). Characters are code points.
//! type JevExample = { reply_opening: string; user_reason?: string };
//!
//! // A criteria side: a string, or TypeSafe's structured Noul criteria, the string as
//! // `what` with one or two examples.
//! type JevCriterion = string | { what: string; examples: JevExample[] };
//!
//! // A second opinion (KTD7): one question per rubric point, one per learning target,
//! // plus one overall. State and instruction keys are TypeSafe's wire names, so
//! // backticked references in question text (`reply`, `point`, `rubric_notes`,
//! // `target`, `task`) resolve.
//! type SecondOpinionRequest = {
//!   kind: "secondOpinion";
//!   state: {
//!     task: string;
//!     rubric_points: string[];    // the rubric's top-level list items, in order
//!     rubric_notes: string;       // the rubric's lines outside its list
//!     rubric: string;             // the full rubric
//!     learning_targets: string[]; // the badge's learning targets, in order; may be empty
//!     reply: string;
//!   };
//!   // Exactly these keys: "p1" … "pN" for rubric_points[0] … rubric_points[N-1],
//!   // "t1" … "tM" for learning_targets[0] … learning_targets[M-1], plus "overall".
//!   // With no rubric points and no targets, only "overall".
//!   questions: Record<string, {
//!     type: "noul";
//!     instructions: string | { point?: string; rubric_notes?: string; target?: string; question: string };
//!     criteria?: { true: JevCriterion; false: JevCriterion };
//!   }>;
//! };
//! // A "t" question's instructions are structured and name its `target`, and its
//! // criteria are strings; no other question names a `target`. Examples ride only on
//! // "p" questions and "overall", and a "p" question's true side carries no `user_reason`.
//!
//! // A head-to-head (jev-in-compare KTD5): two replies to one handoff, compared point by
//! // point in both orders. Backticked references in question text (`reply_1`, `reply_2`,
//! // `point`, `rubric_notes`, `task`) resolve against these wire names.
//! type HeadToHeadRequest = {
//!   kind: "headToHead";
//!   state: {
//!     task: string;
//!     rubric_points: string[];    // the rubric's top-level list items, in order; at least one
//!     rubric_notes: string;       // the rubric's lines outside its list
//!     rubric: string;             // the full rubric
//!     learning_targets: string[]; // the badge's learning targets, in order; may be empty
//!     reply_1: string;            // the first reply, in the compare's order
//!     reply_2: string;            // the second reply
//!   };
//!   // Exactly these keys, for N = rubric_points.length: "a1" … "aN", whether `reply_1`
//!   // covers rubric_points[i-1] better than `reply_2`, and "b1" … "bN", the reverse.
//!   questions: Record<string, {
//!     type: "noul";
//!     instructions: { point: string; rubric_notes?: string; question: string };
//!     criteria?: JevCriteria;
//!   }>;
//! };
//! // Each "a{i}" and "b{i}" question's `point` is rubric_points[i-1]. Its instructions are
//! // never text and never name a `target`, and its criteria are plain strings: no examples.
//!
//! // A line-break cleanup (KTD17): one question per candidate break.
//! type LineBreaksRequest = {
//!   kind: "lineBreaks";
//!   state: string; // only the pasted text, each line tagged with its id ("L014| …")
//!   // Each key is the id of the line that may continue the one before it:
//!   // "L" and one to six digits, e.g. "L015". Criteria are strings only.
//!   questions: Record<string, { type: "noul"; instructions: string; criteria?: JevCriteria }>;
//! };
//!
//! // A routing ask (router KTD1, KTD3): one match question per badge, and at most one
//! // question on how demanding the job is. Badges ride in their own questions, never in
//! // the state, since every question sees all of it.
//! type RouteRequest = {
//!   kind: "route";
//!   state: { job: string };
//!   // Exactly these keys: "m1" … "mN" with N at least 1 and no gap, each a
//!   // MatchQuestion, plus "difficulty" at most once, a DifficultyQuestion. An "m" id is
//!   // "m" and the number as written by `format!`, so "m0", "m01", "M1" and "m1 " are
//!   // refused.
//!   questions: Record<string, MatchQuestion | DifficultyQuestion>;
//! };
//!
//! // Does the `job` ask for the same kind of work as the `badge`? The badge has no field
//! // for its rubric, and the criteria are strings only.
//! type MatchQuestion = {
//!   type: "noul";
//!   instructions: {
//!     badge: { name: string; task: string; learning_targets: string[] };
//!     question: string;
//!   };
//!   criteria?: JevCriteria;
//! };
//!
//! // TypeSafe's Score: the one question that isn't a Noul, allowed under "difficulty" in
//! // a route and nowhere else. Three levels in order (routine, needs judgment, unusual or
//! // high-stakes). The instructions and each level are at most 300 characters (code
//! // points), since TypeSafe's `legend` echoes the levels back.
//! type DifficultyQuestion = { type: "score"; instructions: string; criteria: [string, string, string] };
//!
//! type JevRequest = SecondOpinionRequest | HeadToHeadRequest | LineBreaksRequest | RouteRequest;
//!
//! // Every requested id, and the model that answered (growing context KTD3). Nothing
//! // else from TypeSafe. `model` is the versioned id TypeSafe names when it is a short
//! // one (letters, digits, `.`, `_`, `:`, `/`, `+` and `-`, at most 64 characters). One
//! // that is absent or in any other shape reads as the pinned "jev-1.13.0" and never
//! // fails the ask, for any request.
//! type JevAnswers = {
//!   answers: Record<string, number>; // each Noul id, a probability from 0 to 1
//!   // Each Score id ("difficulty"), its three level probabilities in the order asked,
//!   // always three numbers. The key is absent when the request asked no Score, as for
//!   // every second opinion and cleanup.
//!   levels?: Record<string, number[]>;
//!   model: string;
//! };
//! ```
//!
//! Any other field, at any level (a `model` field included), is refused as
//! `"other"`, as are other question types, a Score anywhere but a route's
//! `"difficulty"`, keys outside the rules above, a head-to-head question whose
//! `point` isn't its key's, and examples, targets or levels placed or sized outside
//! them.
//!
//! An answer is `"other"` when an id is missing, extra or of the wrong type, or a Noul
//! is outside 0 to 1. A Score's answer must be `type: "score"` with `probabilities` an
//! object of exactly `"0"`, `"1"` and `"2"`, each from 0 to 1 and summing to 1 within
//! 0.02. Its `score`, `confidence` and `legend` are dropped, so no text from TypeSafe
//! reaches the web view, and the web view works the expected level out from `levels`.
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
/// A second opinion's examples (growing context KTD2, KTD10): at most two per criteria
/// side, each reply opening 1 to 300 characters, each reason at most 200.
pub const MAX_EXAMPLES_PER_SIDE: usize = 2;
pub const MAX_OPENING_CHARS: usize = 300;
pub const MAX_REASON_CHARS: usize = 200;
/// A route's one Score question (router KTD1), and the most code points its instructions
/// and each of its three levels may hold, since TypeSafe's `legend` echoes the levels back.
pub const DIFFICULTY_ID: &str = "difficulty";
pub const MAX_DIFFICULTY_CHARS: usize = 300;
/// The longest model id an answer may name before it reads as the pinned one (KTD3).
const MAX_MODEL_CHARS: usize = 64;
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
    InvalidRequest,
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

/// Jev's probabilities, keyed by the ask's own question ids, and the model that answered.
/// A Score id's answer is its three level probabilities in `levels`, in order, and never
/// in `answers`. `levels` is left out when empty, so a second opinion's or a cleanup's
/// answer keeps its shape.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Answers {
    pub answers: BTreeMap<String, f64>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub levels: BTreeMap<String, [f64; 3]>,
    pub model: String,
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

/// The four shapes the web view may send. No field beyond these passes, so the
/// web view can write question wording but can't set the model or add to the body.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Ask {
    SecondOpinion(SecondOpinion),
    LineBreaks(LineBreaks),
    HeadToHead(HeadToHead),
    Route(Route),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SecondOpinion {
    state: OpinionState,
    questions: BTreeMap<String, Question<Instructions, OpinionCriteria>>,
}

/// Only the reply, the badge's task, its rubric and its learning targets (R5).
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OpinionState {
    task: String,
    rubric_points: Vec<String>,
    rubric_notes: String,
    rubric: String,
    learning_targets: Vec<String>,
    reply: String,
}

/// One pair of replies compared point by point, in both orders (jev-in-compare KTD5).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HeadToHead {
    state: PairState,
    questions: BTreeMap<String, Question<PairInstructions, Criteria>>,
}

/// Only the two replies, in the compare's order, and the badge's task, rubric and
/// learning targets (jev-in-compare R3).
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PairState {
    task: String,
    rubric_points: Vec<String>,
    rubric_notes: String,
    rubric: String,
    learning_targets: Vec<String>,
    reply_1: String,
    reply_2: String,
}

/// A head-to-head question's instructions: always structured, always naming its point,
/// never a target.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PairInstructions {
    point: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rubric_notes: Option<String>,
    question: String,
}

/// Only the pasted text (R5).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LineBreaks {
    state: String,
    questions: BTreeMap<String, Question<String, Criteria>>,
}

/// Only the job (router KTD3). Badges ride in their own questions, since every question
/// sees all of the state.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Route {
    state: RouteState,
    questions: BTreeMap<String, RouteQuestion>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RouteState {
    job: String,
}

/// A route's question: a match Noul under an "m" id, or the one difficulty Score. This
/// is the only place a Score may appear (router KTD1).
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum RouteQuestion {
    Noul(Match),
    Score(Difficulty),
}

/// Does the job ask for the same kind of work as this one badge? Criteria are strings.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Match {
    instructions: MatchInstructions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    criteria: Option<Criteria>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MatchInstructions {
    badge: Badge,
    question: String,
}

/// A badge as a match names it. There is no field for its rubric.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Badge {
    name: String,
    task: String,
    learning_targets: Vec<String>,
}

/// The job's difficulty: string instructions and exactly three levels, in order.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Difficulty {
    instructions: String,
    criteria: [String; 3],
}

/// One question. `criteria` is optional, so its type needs no `Default` of its own.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, bound(deserialize = "I: Deserialize<'de>, C: Deserialize<'de>"))]
struct Question<I, C> {
    #[serde(rename = "type")]
    kind: Noul,
    instructions: I,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    criteria: Option<C>,
}

/// The only question type a second opinion or a cleanup may carry.
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

/// TypeSafe's structured instructions object, limited to what a point or target question
/// needs. `target` is set on a target question and only there.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StructuredInstructions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    point: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rubric_notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    question: String,
}

/// A cleanup's or a head-to-head's criteria: plain strings only.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Criteria {
    #[serde(rename = "true")]
    yes: String,
    #[serde(rename = "false")]
    no: String,
}

/// A second opinion's criteria, where either side may carry examples.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OpinionCriteria {
    #[serde(rename = "true")]
    yes: Side,
    #[serde(rename = "false")]
    no: Side,
}

/// A criteria side: a string, or TypeSafe's structured Noul criteria.
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum Side {
    Text(String),
    Structured(StructuredSide),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StructuredSide {
    what: String,
    examples: Vec<Example>,
}

/// The opening of an earlier reply, and the user's own note on it, kept apart.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Example {
    reply_opening: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    user_reason: Option<String>,
}

impl Ask {
    /// Reads the web view's request into one of the four shapes, with its keys
    /// following the shape's rules, a second opinion's targets and examples placed and
    /// sized as the contract says, each head-to-head question naming its point, and a
    /// route's one Score where and as it says.
    fn parse(request: Value) -> Result<Ask, JevError> {
        let malformed = JevError::of(Kind::Other);
        let ask: Ask = serde_json::from_value(request).map_err(|_| malformed)?;
        let checked = match &ask {
            Ask::SecondOpinion(o) => {
                let expected: BTreeSet<String> = (1..=o.state.rubric_points.len())
                    .map(|i| format!("p{i}"))
                    .chain((1..=o.state.learning_targets.len()).map(|i| format!("t{i}")))
                    .chain(["overall".to_string()])
                    .collect();
                o.questions.keys().cloned().collect::<BTreeSet<_>>() == expected
                    && o.questions.iter().all(|(id, q)| opinion_question_fits(id, q))
            }
            Ask::LineBreaks(l) => !l.questions.is_empty() && l.questions.keys().all(|id| is_line_id(id)),
            Ask::HeadToHead(h) => {
                let points = &h.state.rubric_points;
                let expected: BTreeSet<String> =
                    (1..=points.len()).flat_map(|i| [format!("a{i}"), format!("b{i}")]).collect();
                !points.is_empty()
                    && h.questions.keys().cloned().collect::<BTreeSet<_>>() == expected
                    && h.questions.iter().all(|(id, q)| asks_its_point(id, q, points))
            }
            Ask::Route(r) => route_fits(r),
        };
        if checked {
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
            Ask::HeadToHead(h) => (tokens(&h.state), h.questions.values().map(tokens).collect()),
            Ask::Route(r) => (tokens(&r.state), r.questions.values().map(tokens).collect()),
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

    /// Every id the ask sends, Score ids included: each must be answered.
    fn ids(&self) -> BTreeSet<String> {
        match self {
            Ask::SecondOpinion(o) => o.questions.keys().cloned().collect(),
            Ask::LineBreaks(l) => l.questions.keys().cloned().collect(),
            Ask::HeadToHead(h) => h.questions.keys().cloned().collect(),
            Ask::Route(r) => r.questions.keys().cloned().collect(),
        }
    }

    /// The ids whose answer is a Score rather than a Noul: a route's difficulty when it
    /// asks one, and none for any other kind.
    fn score_ids(&self) -> BTreeSet<String> {
        match self {
            Ask::Route(r) => r
                .questions
                .iter()
                .filter(|(_, q)| matches!(q, RouteQuestion::Score(_)))
                .map(|(id, _)| id.clone())
                .collect(),
            _ => BTreeSet::new(),
        }
    }

    /// The whole body TypeSafe receives: the state, the pinned model, the questions.
    fn body(&self) -> Value {
        let (state, questions) = match self {
            Ask::SecondOpinion(o) => (serde_json::json!(o.state), serde_json::json!(o.questions)),
            Ask::LineBreaks(l) => (serde_json::json!(l.state), serde_json::json!(l.questions)),
            Ask::HeadToHead(h) => (serde_json::json!(h.state), serde_json::json!(h.questions)),
            Ask::Route(r) => (serde_json::json!(r.state), serde_json::json!(r.questions)),
        };
        serde_json::json!({ "state": state, "model": MODEL, "questions": questions })
    }
}

/// What a second-opinion question's types can't say (growing context KTD2), for a key
/// already checked: a target question names its `target`, no other question does, and
/// its criteria are plain; a side's examples number one or two, each within its size;
/// and a point's true side carries no reason. The sizes hold even if the web view's
/// excerpts don't.
fn opinion_question_fits(id: &str, question: &Question<Instructions, OpinionCriteria>) -> bool {
    let is_target = id.starts_with('t');
    let names_target = matches!(&question.instructions, Instructions::Structured(s) if s.target.is_some());
    if is_target != names_target {
        return false;
    }
    let Some(criteria) = &question.criteria else {
        return true;
    };
    if is_target {
        return matches!((&criteria.yes, &criteria.no), (Side::Text(_), Side::Text(_)));
    }
    let is_point = id.starts_with('p');
    side_fits(&criteria.yes, !is_point) && side_fits(&criteria.no, true)
}

/// Whether a head-to-head question, under a key already checked as "a{i}" or "b{i}",
/// names point i as the state lists it (jev-in-compare KTD5).
fn asks_its_point(id: &str, question: &Question<PairInstructions, Criteria>, points: &[String]) -> bool {
    id.get(1..)
        .and_then(|digits| digits.parse::<usize>().ok())
        .and_then(|i| i.checked_sub(1))
        .and_then(|i| points.get(i))
        .is_some_and(|point| *point == question.instructions.point)
}

fn side_fits(side: &Side, reasons: bool) -> bool {
    match side {
        Side::Text(_) => true,
        Side::Structured(s) => {
            (1..=MAX_EXAMPLES_PER_SIDE).contains(&s.examples.len()) && s.examples.iter().all(|e| example_fits(e, reasons))
        }
    }
}

/// Sizes count characters (code points), as the web view cuts them.
fn example_fits(example: &Example, reasons: bool) -> bool {
    let opening = example.reply_opening.chars().count();
    let reason_fits = example.user_reason.as_deref().is_none_or(|reason| {
        reasons && reason.chars().count() <= MAX_REASON_CHARS && !reason.chars().any(is_line_break)
    });
    (1..=MAX_OPENING_CHARS).contains(&opening) && reason_fits
}

/// Every Unicode line break a reason may not hold, so one can never start a new line in
/// a saved file or in the question.
fn is_line_break(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{b}' | '\u{c}' | '\u{85}' | '\u{2028}' | '\u{2029}')
}

/// "L" and one to six digits, as the cleanup tags its lines.
fn is_line_id(id: &str) -> bool {
    id.strip_prefix('L')
        .is_some_and(|digits| (1..=6).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()))
}

/// A route's keys and types (router KTD1, KTD3): "m1" … "mN" with N at least 1, each a
/// match Noul, and at most one "difficulty", a Score whose instructions and three levels
/// each fit in MAX_DIFFICULTY_CHARS code points. No other key.
fn route_fits(route: &Route) -> bool {
    let difficulty = route.questions.contains_key(DIFFICULTY_ID);
    let matches = route.questions.len() - usize::from(difficulty);
    let expected: BTreeSet<String> = (1..=matches)
        .map(|i| format!("m{i}"))
        .chain(difficulty.then(|| DIFFICULTY_ID.to_string()))
        .collect();
    let fits = |text: &String| text.chars().count() <= MAX_DIFFICULTY_CHARS;
    matches >= 1
        && route.questions.keys().cloned().collect::<BTreeSet<_>>() == expected
        && route.questions.iter().all(|(id, question)| match question {
            RouteQuestion::Noul(_) => id != DIFFICULTY_ID,
            RouteQuestion::Score(d) => id == DIFFICULTY_ID && fits(&d.instructions) && d.criteria.iter().all(fits),
        })
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
        // TypeSafe's validation refused the body, so the app built a bad request.
        Failure::Status(422, _) => JevError::of(Kind::InvalidRequest),
        // Not in TypeSafe's docs, but HTTP's "payload too large": the body is too big, so a retry can't succeed.
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
    /// Read as any value, so a model in an unexpected shape never fails the ask (KTD3).
    #[serde(default)]
    model: Value,
}

/// One answer as far as Jev Mode reads it. Other fields (a Score's `score`, `confidence`
/// and `legend` among them) are ignored and never returned.
#[derive(Deserialize)]
struct WireAnswer {
    #[serde(rename = "type")]
    kind: String,
    noul: Option<f64>,
    /// Read as any value, and parsed only for a Score id, so a Noul answer stays as
    /// tolerant of extra fields as before.
    #[serde(default)]
    probabilities: Option<Value>,
}

/// A Score's level probabilities: exactly the keys "0", "1" and "2".
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireLevels {
    #[serde(rename = "0")]
    routine: f64,
    #[serde(rename = "1")]
    judgment: f64,
    #[serde(rename = "2")]
    high_stakes: f64,
}

/// How far a Score's levels may sum from 1, which allows two-decimal rounding (router KTD1).
const LEVELS_SUM_TOLERANCE: f64 = 0.02;

/// Turns TypeSafe's reply into probabilities keyed by the ask's own ids, with the
/// model that answered. A status that isn't a success never reads the body. Each id in
/// `scores` must be answered with a Score's three levels, and every other id with a Noul.
/// An answer outside 0–1, of another type, missing, or for an id the ask didn't send is
/// "other", never clamped, as are levels that don't sum to 1. The model is never a
/// reason to fail: the cleanup ignores it.
fn answers_from(
    status: u16,
    headers: &HeaderMap,
    body: &[u8],
    ids: &BTreeSet<String>,
    scores: &BTreeSet<String>,
) -> Result<Answers, JevError> {
    if !(200..300).contains(&status) {
        return Err(kind_of(Failure::Status(status, retry_after(headers))));
    }
    let malformed = JevError::of(Kind::Other);
    let reply: WireReply = serde_json::from_slice(body).map_err(|_| malformed)?;
    if reply.answers.len() != ids.len() {
        return Err(malformed);
    }
    let mut answers = BTreeMap::new();
    let mut levels = BTreeMap::new();
    for (id, answer) in reply.answers {
        if !ids.contains(&id) {
            return Err(malformed);
        }
        if scores.contains(&id) {
            levels.insert(id, levels_of(answer).ok_or(malformed)?);
            continue;
        }
        match answer.noul {
            Some(p) if answer.kind == "noul" && (0.0..=1.0).contains(&p) => {
                answers.insert(id, p);
            }
            _ => return Err(malformed),
        }
    }
    Ok(Answers { answers, levels, model: answering_model(&reply.model) })
}

/// A Score answer's three level probabilities, in order, when it is one: `probabilities`
/// an object of exactly "0", "1" and "2", each from 0 to 1, summing to 1.
fn levels_of(answer: WireAnswer) -> Option<[f64; 3]> {
    if answer.kind != "score" {
        return None;
    }
    // A derived struct would also take an array, by position, so only an object is read.
    let read: WireLevels = serde_json::from_value(answer.probabilities.filter(Value::is_object)?).ok()?;
    let levels = [read.routine, read.judgment, read.high_stakes];
    let sum: f64 = levels.iter().sum();
    let fits = levels.iter().all(|p| (0.0..=1.0).contains(p)) && (sum - 1.0).abs() <= LEVELS_SUM_TOLERANCE;
    fits.then_some(levels)
}

/// The model TypeSafe names when it is a short id (letters, digits, `.`, `_`, `:`, `/`,
/// `+` and `-`, at most 64 characters), else the pinned model.
fn answering_model(model: &Value) -> String {
    let short_id = |id: &&str| {
        (1..=MAX_MODEL_CHARS).contains(&id.len())
            && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '+' | '-'))
    };
    model.as_str().filter(short_id).unwrap_or(MODEL).to_string()
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
    answers_from(status, response.headers(), &body, &ask.ids(), &ask.score_ids())
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
        opinion_with(points, 0)
    }

    /// A second opinion on `points` rubric points and `targets` learning targets, with
    /// string criteria on every question.
    fn opinion_with(points: usize, targets: usize) -> Value {
        let rubric_points: Vec<String> = (1..=points).map(|i| format!("Point {i}")).collect();
        let learning_targets: Vec<String> = (1..=targets).map(|i| format!("Target {i}")).collect();
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
        for i in 1..=targets {
            questions.insert(
                format!("t{i}"),
                json!({
                    "type": "noul",
                    "instructions": {
                        "target": format!("Target {i}"),
                        "question": "Does `reply` show the work `target` describes, given `task`?"
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
                "learning_targets": learning_targets,
                "reply": "Done. I wrote README.md with an install section."
            },
            "questions": questions
        })
    }

    /// One example: the opening of an earlier reply, with the user's note when given.
    fn example(opening: &str, reason: Option<&str>) -> Value {
        match reason {
            Some(reason) => json!({ "reply_opening": opening, "user_reason": reason }),
            None => json!({ "reply_opening": opening }),
        }
    }

    /// A criteria side with these examples.
    fn side(examples: Vec<Value>) -> Value {
        json!({ "what": "the reply names the files", "examples": examples })
    }

    /// Two points and two targets, with examples on both sides of p1 and on overall's
    /// true side, as the web view sends them.
    fn opinion_with_examples() -> Value {
        let mut o = opinion_with(2, 2);
        o["questions"]["p1"]["criteria"] = json!({
            "true": side(vec![
                example("I added README.md with an install section.", None),
                example("README.md now covers install and usage.", None),
            ]),
            "false": side(vec![example("Done, the README is updated.", Some("names no file"))]),
        });
        o["questions"]["overall"]["criteria"]["true"] =
            side(vec![example("I added README.md with an install section.", Some("shows the install command"))]);
        o
    }

    /// The web view's budget test for a second opinion with examples sends this same
    /// request (`withExamples` in src/domain/jevBudget.test.ts).
    fn opinion_for_budget(reply_chars: usize, examples: bool) -> Value {
        let criteria = if examples {
            json!({
                "true": { "what": "w", "examples": [{ "reply_opening": "o".repeat(300) }, { "reply_opening": "o".repeat(300) }] },
                "false": { "what": "w", "examples": [{ "reply_opening": "n".repeat(300), "user_reason": "r".repeat(200) }] }
            })
        } else {
            json!({ "true": "w", "false": "w" })
        };
        json!({
            "kind": "secondOpinion",
            "state": {
                "task": "Write the README",
                "rubric_points": ["Point 1"],
                "rubric_notes": "",
                "rubric": "- Point 1",
                "learning_targets": ["Target 1"],
                "reply": "y".repeat(reply_chars)
            },
            "questions": {
                "p1": { "type": "noul", "instructions": { "point": "Point 1", "question": "q" }, "criteria": criteria },
                "t1": { "type": "noul", "instructions": { "target": "Target 1", "question": "q" }, "criteria": { "true": "w", "false": "w" } },
                "overall": { "type": "noul", "instructions": "q" }
            }
        })
    }

    /// A head-to-head on `points` rubric points: "a{i}" asks whether `reply_1` covers point
    /// i better than `reply_2`, "b{i}" the reverse, each with string criteria.
    fn pair(points: usize) -> Value {
        let rubric_points: Vec<String> = (1..=points).map(|i| format!("Point {i}")).collect();
        let mut questions = serde_json::Map::new();
        for i in 1..=points {
            for (id, over, under) in [("a", "reply_1", "reply_2"), ("b", "reply_2", "reply_1")] {
                questions.insert(
                    format!("{id}{i}"),
                    json!({
                        "type": "noul",
                        "instructions": {
                            "point": format!("Point {i}"),
                            "rubric_notes": "A rewrite in other words passes.",
                            "question": format!("Does `{over}` cover `point` better than `{under}`, read with `rubric_notes`, given `task`?")
                        },
                        "criteria": criteria()
                    }),
                );
            }
        }
        json!({
            "kind": "headToHead",
            "state": {
                "task": "Write the README",
                "rubric_points": rubric_points,
                "rubric_notes": "A rewrite in other words passes.",
                "rubric": "- Point 1\n- Point 2",
                "learning_targets": ["Target 1"],
                "reply_1": "Done. I wrote README.md with an install section.",
                "reply_2": "Done, the README is updated."
            },
            "questions": questions
        })
    }

    /// The web view's budget test for a head-to-head sends this same request (`pairForBudget`
    /// in src/domain/jevBudget.test.ts).
    fn pair_for_budget(reply_chars: usize) -> Value {
        let question = json!({ "type": "noul", "instructions": { "point": "Point 1", "question": "q" }, "criteria": { "true": "w", "false": "w" } });
        json!({
            "kind": "headToHead",
            "state": {
                "task": "Write the README",
                "rubric_points": ["Point 1"],
                "rubric_notes": "",
                "rubric": "- Point 1",
                "learning_targets": ["Target 1"],
                "reply_1": "y".repeat(reply_chars),
                "reply_2": "z".repeat(reply_chars)
            },
            "questions": { "a1": question.clone(), "b1": question }
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

    /// A match question for badge `i`, as the router sends it (KTD3).
    fn match_question(i: usize) -> Value {
        json!({
            "type": "noul",
            "instructions": {
                "badge": {
                    "name": format!("Badge {i}"),
                    "task": "Review the diff and name the bug.",
                    "learning_targets": ["I can find a bug in a diff", "I can point to the line"]
                },
                "question": "Does the `job` ask for the same kind of work as the `badge`?"
            },
            "criteria": {
                "true": "the work the badge's task and learning targets describe",
                "false": "a different kind of work, or one that only shares a topic, a tool or a word with the badge"
            }
        })
    }

    /// The one difficulty question (KTD1).
    fn difficulty_question() -> Value {
        json!({
            "type": "score",
            "instructions": "How demanding is the `job` for an agent?",
            "criteria": ["routine", "needs judgment", "unusual or high-stakes"]
        })
    }

    /// A route asking about `matches` badges, with the difficulty question when `difficulty`.
    fn route(matches: usize, difficulty: bool) -> Value {
        let mut questions: serde_json::Map<String, Value> =
            (1..=matches).map(|i| (format!("m{i}"), match_question(i))).collect();
        if difficulty {
            questions.insert(DIFFICULTY_ID.into(), difficulty_question());
        }
        json!({ "kind": "route", "state": { "job": "Fix the flaky login test." }, "questions": questions })
    }

    /// The same request with one question moved to another id.
    fn rekeyed(mut request: Value, from: &str, to: &str) -> Value {
        let questions = request["questions"].as_object_mut().unwrap();
        let question = questions.remove(from).unwrap();
        questions.insert(to.to_string(), question);
        request
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
        assert_eq!(status(422), JevError::of(Kind::InvalidRequest));
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
        let limited = answers_from(429, &headers, b"", &none, &BTreeSet::new()).unwrap_err();
        assert_eq!(limited, JevError { kind: Kind::RateLimited, status: None, retry_after: Some(7) });
        assert_eq!(answers_from(529, &headers, b"", &none, &BTreeSet::new()).unwrap_err().retry_after, Some(7));
        assert_eq!(answers_from(500, &headers, b"", &none, &BTreeSet::new()).unwrap_err().retry_after, None);

        headers.insert(RETRY_AFTER, HeaderValue::from_static("Wed, 21 Oct 2026 07:28:00 GMT"));
        assert_eq!(answers_from(429, &headers, b"", &none, &BTreeSet::new()).unwrap_err().retry_after, None);
    }

    #[test]
    fn a_refused_reply_never_carries_its_body_into_the_error() {
        let body = format!(r#"{{"detail":"invalid key {KEY}","state":"Done. I wrote README.md"}}"#);
        for code in [401, 422] {
            let err = answers_from(code, &HeaderMap::new(), body.as_bytes(), &ids(&["overall"]), &BTreeSet::new()).unwrap_err();
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
        let answers = answers_from(200, &HeaderMap::new(), body, &ids(&["p1", "overall"]), &BTreeSet::new()).unwrap();
        assert_eq!(answers.answers, BTreeMap::from([("overall".to_string(), 0.0), ("p1".to_string(), 0.92)]));
        assert_eq!(
            serde_json::to_value(&answers).unwrap(),
            json!({ "answers": { "overall": 0.0, "p1": 0.92 }, "model": "jev-1.13.0" })
        );
        // A second opinion asks no Score, so its answer has no levels key at all.
        assert_eq!(serde_json::to_string(&answers).unwrap(), r#"{"answers":{"overall":0.0,"p1":0.92},"model":"jev-1.13.0"}"#);
    }

    /// TypeSafe's documented Score answer, with the levels it echoes back.
    const SCORE_ANSWER: &str = r#"{"type":"score","score":1.43,"confidence":0.35,"legend":{"0":"routine","1":"needs judgment","2":"unusual or high-stakes"},"probabilities":{"0":0.0,"1":0.57,"2":0.43}}"#;

    /// A reply to `route(2, true)`, with this answer for `difficulty`.
    fn route_reply(difficulty: &str) -> String {
        format!(
            r#"{{"model":"jev-1.13.0","answers":{{"m1":{{"type":"noul","noul":0.91,"explanation":"same work"}},"m2":{{"type":"noul","noul":0.12}},"difficulty":{difficulty}}},"usage":{{"input_tokens":410}}}}"#
        )
    }

    #[test]
    fn a_routes_score_comes_back_as_its_three_levels_beside_the_nouls() {
        let asked = ids(&["difficulty", "m1", "m2"]);
        let answers = answers_from(200, &HeaderMap::new(), route_reply(SCORE_ANSWER).as_bytes(), &asked, &ids(&["difficulty"])).unwrap();
        assert_eq!(answers.answers, BTreeMap::from([("m1".to_string(), 0.91), ("m2".to_string(), 0.12)]));
        assert_eq!(answers.levels, BTreeMap::from([("difficulty".to_string(), [0.0, 0.57, 0.43])]));
        assert_eq!(
            serde_json::to_value(&answers).unwrap(),
            json!({ "answers": { "m1": 0.91, "m2": 0.12 }, "levels": { "difficulty": [0.0, 0.57, 0.43] }, "model": "jev-1.13.0" })
        );
        // Nothing TypeSafe wrote beside the numbers reaches the web view.
        let sent = serde_json::to_string(&answers).unwrap();
        for text in ["routine", "judgment", "1.43", "0.35", "same work"] {
            assert!(!sent.contains(text), "{text} in {sent}");
        }
    }

    #[test]
    fn levels_rounded_to_two_decimals_are_accepted() {
        let asked = ids(&["difficulty", "m1", "m2"]);
        let thirds = r#"{"type":"score","probabilities":{"0":0.33,"1":0.33,"2":0.33}}"#;
        let answers = answers_from(200, &HeaderMap::new(), route_reply(thirds).as_bytes(), &asked, &ids(&["difficulty"])).unwrap();
        assert_eq!(answers.levels["difficulty"], [0.33, 0.33, 0.33]);
        let certain = r#"{"type":"score","probabilities":{"0":1,"1":0,"2":0}}"#;
        let answers = answers_from(200, &HeaderMap::new(), route_reply(certain).as_bytes(), &asked, &ids(&["difficulty"])).unwrap();
        assert_eq!(answers.levels["difficulty"], [1.0, 0.0, 0.0]);
    }

    #[test]
    fn a_route_answer_out_of_shape_is_other() {
        let asked = ids(&["difficulty", "m1", "m2"]);
        let scores = ids(&["difficulty"]);
        let malformed = JevError::of(Kind::Other);
        let read = |body: &str| answers_from(200, &HeaderMap::new(), body.as_bytes(), &asked, &scores);
        let with = |probabilities: &str| {
            route_reply(&format!(r#"{{"type":"score","score":1.0,"confidence":0.5,"probabilities":{probabilities}}}"#))
        };
        let refused = [
            ("a missing level", with(r#"{"0":0.5,"1":0.5}"#)),
            ("an extra level", with(r#"{"0":0.5,"1":0.5,"2":0,"3":0}"#)),
            ("a level keyed 00", with(r#"{"00":0.5,"1":0.5,"2":0}"#)),
            ("a level keyed 1.0", with(r#"{"0":0.5,"1.0":0.5,"2":0}"#)),
            ("probabilities as an array", with("[0.0,0.57,0.43]")),
            ("probabilities as a number", with("1")),
            ("a level as text", with(r#"{"0":"1","1":0,"2":0}"#)),
            ("a level over 1", with(r#"{"0":1.01,"1":0,"2":-0.01}"#)),
            ("a level under 0", with(r#"{"0":-0.5,"1":0.5,"2":1}"#)),
            ("a level written 1e999", with(r#"{"0":1e999,"1":0,"2":0}"#)),
            ("levels summing to 0", with(r#"{"0":0,"1":0,"2":0}"#)),
            ("levels summing to 0.9", with(r#"{"0":0.3,"1":0.3,"2":0.3}"#)),
            ("levels summing to 3", with(r#"{"0":1,"1":1,"2":1}"#)),
            ("a score with no probabilities", route_reply(r#"{"type":"score","score":1.0,"confidence":0.5}"#)),
            ("a noul answer for difficulty", route_reply(r#"{"type":"noul","noul":0.5}"#)),
            ("a choice answer for difficulty", route_reply(r#"{"type":"choice","choice":"routine"}"#)),
            (
                "a score answer for a noul id",
                format!(r#"{{"answers":{{"m1":{SCORE_ANSWER},"m2":{{"type":"noul","noul":0.12}},"difficulty":{SCORE_ANSWER}}}}}"#),
            ),
            ("a missing difficulty answer", r#"{"answers":{"m1":{"type":"noul","noul":0.9},"m2":{"type":"noul","noul":0.1}}}"#.to_string()),
        ];
        for (what, body) in refused {
            assert_eq!(read(&body).unwrap_err(), malformed, "{what}");
        }

        // A route that asked no difficulty gets none back.
        let unasked = answers_from(200, &HeaderMap::new(), route_reply(SCORE_ANSWER).as_bytes(), &ids(&["m1", "m2"]), &BTreeSet::new());
        assert_eq!(unasked.unwrap_err(), malformed, "a difficulty answer to a route that asked none");
    }

    #[test]
    fn the_answer_names_the_model_that_answered_or_the_pinned_one() {
        let asked = ids(&["p1", "t1", "overall"]);
        let model_of = |model: &str| {
            let body = format!(
                r#"{{"answers":{{"p1":{{"type":"noul","noul":0.5}},"t1":{{"type":"noul","noul":0.4}},"overall":{{"type":"noul","noul":0.6}}}}{model}}}"#
            );
            answers_from(200, &HeaderMap::new(), body.as_bytes(), &asked, &BTreeSet::new()).expect("the ask succeeds").model
        };
        assert_eq!(model_of(r#","model":"jev-1.13.2""#), "jev-1.13.2");
        assert_eq!(model_of(r#","model":"jev:1.14/beta+2_rc.1-a""#), "jev:1.14/beta+2_rc.1-a");
        let longest = "m".repeat(64);
        assert_eq!(model_of(&format!(r#","model":"{longest}""#)), longest);

        let too_long = format!(r#","model":"{}""#, "m".repeat(65));
        let fallbacks = [
            ("absent", ""),
            ("with a space", r#","model":"jev 1.13""#),
            ("over 64 characters", too_long.as_str()),
            ("empty", r#","model":"""#),
            ("not ASCII", r#","model":"jév-1.13""#),
            ("a number", r#","model":113"#),
            ("null", r#","model":null"#),
            ("an object", r#","model":{"id":"jev-2"}"#),
        ];
        for (what, model) in fallbacks {
            assert_eq!(model_of(model), MODEL, "{what}");
        }
    }

    #[test]
    fn a_cleanups_answer_succeeds_whatever_model_it_names() {
        let asked = ids(&["L002"]);
        for model in [r#""model":"jev-1.13.0","#, r#""model":"not a model id!","#, r#""model":[1,2],"#, ""] {
            let body = format!(r#"{{{model}"answers":{{"L002":{{"type":"noul","noul":0.9}}}}}}"#);
            let answers = answers_from(200, &HeaderMap::new(), body.as_bytes(), &asked, &BTreeSet::new()).expect(model);
            assert_eq!(answers.answers, BTreeMap::from([("L002".to_string(), 0.9)]));
        }
    }

    #[test]
    fn an_answer_outside_zero_to_one_or_for_an_unknown_id_is_other() {
        let asked = ids(&["p1"]);
        let other = |body: &str| answers_from(200, &HeaderMap::new(), body.as_bytes(), &asked, &BTreeSet::new()).unwrap_err();
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
            (Kind::InvalidRequest, "invalidRequest"),
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
            serde_json::to_value(JevError { kind: Kind::Other, status: Some(500), retry_after: None }).unwrap(),
            json!({ "kind": "other", "status": 500, "retryAfter": null })
        );
        assert_eq!(
            serde_json::to_value(JevError::of(Kind::InvalidRequest)).unwrap(),
            json!({ "kind": "invalidRequest", "status": null, "retryAfter": null })
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

        // Learning targets, structured criteria and examples (growing context KTD2). Each
        // changes one thing in a request that is accepted as it stands.
        let base = opinion_with_examples;
        let mut no_targets = opinion(1);
        no_targets["state"].as_object_mut().unwrap().remove("learning_targets");
        let mut extra_target = base();
        extra_target["questions"]["t3"] = extra_target["questions"]["t1"].clone();
        let mut missing_target = base();
        missing_target["questions"].as_object_mut().unwrap().remove("t2");
        let mut target_as_text = base();
        target_as_text["questions"]["t1"]["instructions"] = json!("Does `reply` show the work?");
        let mut target_without_target = base();
        target_without_target["questions"]["t1"]["instructions"].as_object_mut().unwrap().remove("target");
        let mut point_with_target = base();
        point_with_target["questions"]["p2"]["instructions"]["target"] = json!("Target 1");
        let mut overall_with_target = base();
        overall_with_target["questions"]["overall"]["instructions"] =
            json!({ "target": "Target 1", "question": "Does `reply` satisfy all of `rubric`?" });
        let mut target_examples = base();
        target_examples["questions"]["t1"]["criteria"]["true"] = side(vec![example("I added README.md.", None)]);
        let mut extra_example = base();
        extra_example["questions"]["p1"]["criteria"]["false"]["examples"][0]["agent"] = json!("claude");
        let mut no_opening = base();
        no_opening["questions"]["p1"]["criteria"]["false"]["examples"][0] = json!({ "user_reason": "names no file" });
        let mut no_what = base();
        no_what["questions"]["p1"]["criteria"]["false"].as_object_mut().unwrap().remove("what");
        let mut what_alone = base();
        what_alone["questions"]["p1"]["criteria"]["false"].as_object_mut().unwrap().remove("examples");
        let mut extra_side = base();
        extra_side["questions"]["p1"]["criteria"]["false"]["weight"] = json!(2);
        let mut no_examples = base();
        no_examples["questions"]["p1"]["criteria"]["false"]["examples"] = json!([]);
        let mut three_examples = base();
        three_examples["questions"]["p1"]["criteria"]["false"]["examples"] =
            json!([example("One.", None), example("Two.", None), example("Three.", None)]);
        let mut structured_cleanup = line_breaks(&["L002"]);
        structured_cleanup["questions"]["L002"]["criteria"]["true"] = side(vec![example("L001| a", None)]);
        let mut empty_opening = base();
        empty_opening["questions"]["p1"]["criteria"]["false"]["examples"][0]["reply_opening"] = json!("");
        let mut long_opening = base();
        long_opening["questions"]["p1"]["criteria"]["false"]["examples"][0]["reply_opening"] = json!("a".repeat(301));
        let mut long_reason = base();
        long_reason["questions"]["p1"]["criteria"]["false"]["examples"][0]["user_reason"] = json!("r".repeat(201));
        let mut reason_on_holds = base();
        reason_on_holds["questions"]["p1"]["criteria"]["true"]["examples"][0]["user_reason"] = json!("shows the install");

        // Head-to-head (jev-in-compare KTD5). Each changes one thing in `pair(2)`, which is
        // accepted as it stands. A question under a key outside the rule is a clone of "a1",
        // so the key rule is what refuses it.
        let mut pair_extra_state = pair(2);
        pair_extra_state["state"]["reply_3"] = json!("A third reply.");
        let mut pair_no_reply_2 = pair(2);
        pair_no_reply_2["state"].as_object_mut().unwrap().remove("reply_2");
        let mut pair_no_targets = pair(2);
        pair_no_targets["state"].as_object_mut().unwrap().remove("learning_targets");
        let mut pair_missing_b2 = pair(2);
        pair_missing_b2["questions"].as_object_mut().unwrap().remove("b2");
        let pair_extra = |id: &str| {
            let mut p = pair(2);
            p["questions"][id] = p["questions"]["a1"].clone();
            p
        };
        let (pair_overall, pair_p1, pair_a3) = (pair_extra("overall"), pair_extra("p1"), pair_extra("a3"));
        let mut pair_text = pair(2);
        pair_text["questions"]["a1"]["instructions"] =
            json!("Does `reply_1` cover `point` better than `reply_2`, given `task`?");
        let mut pair_target = pair(2);
        pair_target["questions"]["b1"]["instructions"]["target"] = json!("Target 1");
        let mut pair_wrong_point = pair(2);
        pair_wrong_point["questions"]["a2"]["instructions"]["point"] = json!("Point 1");
        let mut pair_no_point = pair(2);
        pair_no_point["questions"]["b2"]["instructions"].as_object_mut().unwrap().remove("point");
        let mut pair_examples = pair(2);
        pair_examples["questions"]["a1"]["criteria"]["true"] = side(vec![example("I added README.md.", None)]);
        let mut pair_extra_instructions = pair(2);
        pair_extra_instructions["questions"]["a1"]["instructions"]["memory"] = json!("x");

        let breaks = [
            ("a reason with a line feed", '\n'),
            ("a reason with a carriage return", '\r'),
            ("a reason with a vertical tab", '\u{b}'),
            ("a reason with a form feed", '\u{c}'),
            ("a reason with a next line", '\u{85}'),
            ("a reason with a line separator", '\u{2028}'),
            ("a reason with a paragraph separator", '\u{2029}'),
        ];

        let mut refused = vec![
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
            ("no learning_targets", no_targets),
            ("a target question for no target", extra_target),
            ("a target with no question", missing_target),
            ("a target question with text instructions", target_as_text),
            ("a target question with no target", target_without_target),
            ("a target on a point question", point_with_target),
            ("a target on the overall question", overall_with_target),
            ("examples on a target question", target_examples),
            ("an unknown example field", extra_example),
            ("an example with no reply_opening", no_opening),
            ("examples with no what", no_what),
            ("a structured side with no examples", what_alone),
            ("an unknown structured side field", extra_side),
            ("an empty examples list", no_examples),
            ("three examples on a side", three_examples),
            ("structured criteria in a cleanup", structured_cleanup),
            ("an empty reply_opening", empty_opening),
            ("a reply_opening over 300 characters", long_opening),
            ("a user_reason over 200 characters", long_reason),
            ("a user_reason on a point's true side", reason_on_holds),
            ("an unknown head-to-head state field", pair_extra_state),
            ("a head-to-head with no reply_2", pair_no_reply_2),
            ("a head-to-head with no learning_targets", pair_no_targets),
            ("a head-to-head with no points", pair(0)),
            ("a head-to-head missing b2", pair_missing_b2),
            ("an overall question in a head-to-head", pair_overall),
            ("a p1 question in a head-to-head", pair_p1),
            ("a head-to-head question for no point", pair_a3),
            ("a head-to-head question with text instructions", pair_text),
            ("a head-to-head question naming a target", pair_target),
            ("a head-to-head point that isn't rubric_points[i-1]", pair_wrong_point),
            ("a head-to-head question with no point", pair_no_point),
            ("examples in a head-to-head", pair_examples),
            ("an unknown head-to-head instructions field", pair_extra_instructions),
        ];
        for (what, line_break) in breaks {
            let mut broken = base();
            broken["questions"]["p1"]["criteria"]["false"]["examples"][0]["user_reason"] =
                json!(format!("names no{line_break}file"));
            refused.push((what, broken));
        }
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
    fn an_ask_with_targets_and_examples_is_sent_as_it_came() {
        let r = rig_on();
        let request = opinion_with_examples();
        let prepared = r.jev.prepare(&r.file, request.clone()).unwrap();
        assert_eq!(prepared.ask.ids(), ids(&["overall", "p1", "p2", "t1", "t2"]));
        let body = prepared.ask.body();
        assert_eq!(body["state"], request["state"]);
        assert_eq!(body["questions"], request["questions"]);
        assert_eq!(body["state"]["learning_targets"], json!(["Target 1", "Target 2"]));
        assert_eq!(body["questions"]["t2"]["instructions"]["target"], "Target 2");
        assert_eq!(body["questions"]["p1"]["criteria"]["false"]["examples"][0]["user_reason"], "names no file");
    }

    #[test]
    fn a_head_to_head_sends_exactly_its_state_the_pinned_model_and_its_questions() {
        let r = rig_on();
        let request = pair(2);
        let prepared = r.jev.prepare(&r.file, request.clone()).unwrap();
        assert_eq!(r.store.reads(), 1);
        assert_eq!(prepared.ask.ids(), ids(&["a1", "a2", "b1", "b2"]));
        assert_eq!(
            prepared.ask.body(),
            json!({ "state": request["state"], "model": MODEL, "questions": request["questions"] })
        );

        // Notes and criteria are optional on each question, as elsewhere.
        let mut bare = pair(1);
        for id in ["a1", "b1"] {
            bare["questions"][id].as_object_mut().unwrap().remove("criteria");
            bare["questions"][id]["instructions"].as_object_mut().unwrap().remove("rubric_notes");
        }
        let prepared = r.jev.prepare(&r.file, bare.clone()).unwrap();
        assert_eq!(prepared.ask.body()["questions"], bare["questions"]);
    }

    #[test]
    fn examples_at_their_largest_are_accepted_counting_code_points() {
        let r = rig_on();
        let mut request = opinion_with_examples();
        // 300 and 200 code points, each ending in an emoji the web view never splits.
        let opening = format!("{}😀", "a".repeat(299));
        let reason = format!("{}😀", "r".repeat(199));
        request["questions"]["p1"]["criteria"]["false"] = side(vec![example(&opening, Some(&reason)), example(&opening, None)]);
        request["questions"]["overall"]["criteria"]["false"] = side(vec![example(&opening, Some(&reason))]);
        assert!(r.jev.prepare(&r.file, request).is_ok());
    }

    #[test]
    fn example_text_counts_toward_the_budget_at_the_web_views_sizes() {
        // The same request refuses at the same reply length in src/domain/jevBudget.test.ts.
        let r = rig_on();
        let Ask::SecondOpinion(o) = Ask::parse(opinion_for_budget(0, true)).unwrap() else {
            panic!("a second opinion");
        };
        assert_eq!(tokens(&o.questions["p1"]), 332);
        assert!(r.jev.prepare(&r.file, opinion_for_budget(126_535, true)).is_ok());
        assert_eq!(kind(r.jev.prepare(&r.file, opinion_for_budget(126_536, true))), Kind::TooLong);
        assert!(r.jev.prepare(&r.file, opinion_for_budget(126_536, false)).is_ok());
    }

    // Routes (router KTD1, KTD3, KTD7)

    #[test]
    fn a_route_is_prepared_and_sends_only_state_model_and_questions() {
        let r = rig_on();
        let request = route(2, true);
        let prepared = r.jev.prepare(&r.file, request.clone()).unwrap();
        assert_eq!(r.store.reads(), 1);
        assert_eq!(prepared.ask.ids(), ids(&["difficulty", "m1", "m2"]));
        assert_eq!(prepared.ask.score_ids(), ids(&["difficulty"]));
        let body = prepared.ask.body();
        let fields: BTreeSet<&str> = body.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        assert_eq!(fields, BTreeSet::from(["model", "questions", "state"]));
        assert_eq!(body["model"], MODEL);
        assert_eq!(body["state"], json!({ "job": "Fix the flaky login test." }));
        assert_eq!(body["questions"], request["questions"]);

        let alone = r.jev.prepare(&r.file, route(1, false)).unwrap();
        assert_eq!(alone.ask.ids(), ids(&["m1"]));
        assert!(alone.ask.score_ids().is_empty());
        assert_eq!(alone.ask.body()["questions"], route(1, false)["questions"]);
    }

    #[test]
    fn only_a_route_has_score_ids() {
        assert!(Ask::parse(opinion_with_examples()).unwrap().score_ids().is_empty());
        assert!(Ask::parse(line_breaks(&["L002", "L003"])).unwrap().score_ids().is_empty());
        assert!(Ask::parse(pair(2)).unwrap().score_ids().is_empty());
    }

    #[test]
    fn difficulty_text_at_its_largest_is_accepted_counting_code_points() {
        let r = rig_on();
        let longest = format!("{}😀", "a".repeat(MAX_DIFFICULTY_CHARS - 1));
        let mut request = route(1, true);
        request["questions"]["difficulty"]["instructions"] = json!(longest);
        request["questions"]["difficulty"]["criteria"] = json!([longest, longest, longest]);
        assert!(r.jev.prepare(&r.file, request).is_ok());
    }

    #[test]
    fn malformed_routes_are_refused_before_the_key_read() {
        let r = rig_on();
        assert!(Ask::parse(route(2, true)).is_ok(), "each row changes one thing in a route that is accepted");
        let base = || route(2, true);
        let changed = |change: &dyn Fn(&mut Value)| {
            let mut request = base();
            change(&mut request);
            request
        };
        let over = "a".repeat(MAX_DIFFICULTY_CHARS + 1);
        let score = json!({ "type": "score", "instructions": "How demanding?", "criteria": ["a", "b", "c"] });

        let mut refused = vec![
            // The ask and its state.
            ("a model field", changed(&|q| q["model"] = json!("jev-latest"))),
            ("state as a string", changed(&|q| q["state"] = json!("Fix the flaky login test."))),
            ("state.job as an object", changed(&|q| q["state"]["job"] = json!({ "text": "Fix it" }))),
            ("an extra state field", changed(&|q| q["state"]["badges"] = json!(["Badge 1"]))),
            ("no state", changed(&|q| _ = q.as_object_mut().unwrap().remove("state"))),
            // Question types.
            ("a score under m1", changed(&|q| q["questions"]["m1"] = difficulty_question())),
            ("a noul under difficulty", changed(&|q| q["questions"]["difficulty"] = match_question(3))),
            ("choice under m1", changed(&|q| q["questions"]["m1"]["type"] = json!("choice"))),
            ("choice under difficulty", changed(&|q| q["questions"]["difficulty"]["type"] = json!("choice"))),
            ("a match with no type", changed(&|q| _ = q["questions"]["m1"].as_object_mut().unwrap().remove("type"))),
            (
                "a difficulty with no type",
                changed(&|q| _ = q["questions"]["difficulty"].as_object_mut().unwrap().remove("type")),
            ),
            // The difficulty question.
            ("two levels", changed(&|q| q["questions"]["difficulty"]["criteria"] = json!(["routine", "unusual"]))),
            ("four levels", changed(&|q| q["questions"]["difficulty"]["criteria"] = json!(["a", "b", "c", "d"]))),
            (
                "a difficulty with no criteria",
                changed(&|q| _ = q["questions"]["difficulty"].as_object_mut().unwrap().remove("criteria")),
            ),
            (
                "structured levels",
                changed(&|q| {
                    q["questions"]["difficulty"]["criteria"] = json!([{ "what": "routine" }, { "what": "judgment" }, { "what": "unusual" }])
                }),
            ),
            (
                "criteria as true and false on the difficulty",
                changed(&|q| q["questions"]["difficulty"]["criteria"] = json!({ "true": "hard", "false": "easy" })),
            ),
            (
                "structured difficulty instructions",
                changed(&|q| q["questions"]["difficulty"]["instructions"] = json!({ "question": "How demanding?" })),
            ),
            ("a level over 300 characters", changed(&|q| q["questions"]["difficulty"]["criteria"][1] = json!(over))),
            ("difficulty instructions over 300 characters", changed(&|q| q["questions"]["difficulty"]["instructions"] = json!(over))),
            ("an extra difficulty field", changed(&|q| q["questions"]["difficulty"]["weight"] = json!(2))),
            // A match question.
            ("a rubric in the badge", changed(&|q| q["questions"]["m1"]["instructions"]["badge"]["rubric"] = json!("- Names the bug"))),
            ("an extra badge field", changed(&|q| q["questions"]["m1"]["instructions"]["badge"]["holders"] = json!(["Claude Code"]))),
            (
                "a badge with no learning_targets",
                changed(&|q| _ = q["questions"]["m1"]["instructions"]["badge"].as_object_mut().unwrap().remove("learning_targets")),
            ),
            ("an extra question field", changed(&|q| q["questions"]["m1"]["weight"] = json!(2))),
            ("a point in a match's instructions", changed(&|q| q["questions"]["m1"]["instructions"]["point"] = json!("Names the bug"))),
            ("a target in a match's instructions", changed(&|q| q["questions"]["m1"]["instructions"]["target"] = json!("I can find a bug"))),
            ("rubric_notes in a match's instructions", changed(&|q| q["questions"]["m1"]["instructions"]["rubric_notes"] = json!("x"))),
            ("text instructions on a match", changed(&|q| q["questions"]["m1"]["instructions"] = json!("Is the job like Badge 1?"))),
            (
                "structured criteria with examples on a match",
                changed(&|q| q["questions"]["m1"]["criteria"]["true"] = side(vec![example("I fixed the test.", None)])),
            ),
            // Ids.
            ("m1 and m3, a gap", rekeyed(base(), "m2", "m3")),
            ("m0", rekeyed(route(1, true), "m1", "m0")),
            ("m01", rekeyed(route(1, true), "m1", "m01")),
            ("M1", rekeyed(route(1, true), "m1", "M1")),
            ("\"m1 \"", rekeyed(route(1, true), "m1", "m1 ")),
            ("a1", rekeyed(route(1, true), "m1", "a1")),
            ("an unknown key", changed(&|q| q["questions"]["overall"] = match_question(3))),
            ("a route with no match question", route(0, true)),
            ("a route with no questions", route(0, false)),
            // A Score anywhere but a route's difficulty.
            ("a score in a second opinion", {
                let mut o = opinion(1);
                o["questions"]["overall"] = score.clone();
                o
            }),
            ("a score in a cleanup", {
                let mut l = line_breaks(&["L002"]);
                l["questions"]["L002"] = score.clone();
                l
            }),
            ("a score in a head-to-head", {
                let mut h = pair(1);
                h["questions"]["a1"] = score.clone();
                h
            }),
        ];
        let mut difficulty_in_opinion = opinion(1);
        difficulty_in_opinion["questions"]["difficulty"] = difficulty_question();
        refused.push(("a difficulty question in a second opinion", difficulty_in_opinion));

        for (what, request) in refused {
            assert_eq!(kind(r.jev.prepare(&r.file, request)), Kind::Other, "{what}");
        }
        assert_eq!(r.store.reads(), 0);
    }

    #[test]
    fn over_budget_routes_are_refused_before_the_key_read() {
        let r = rig_on();
        assert_eq!(kind(r.jev.prepare(&r.file, route(MAX_QUESTIONS + 1, false))), Kind::TooLong, "too many match questions");
        assert_eq!(kind(r.jev.prepare(&r.file, route(MAX_QUESTIONS, true))), Kind::TooLong, "too many with difficulty");

        // The job beside one question over 32k tokens (128k characters).
        let mut long_job = route(1, false);
        long_job["state"]["job"] = json!("x".repeat(4 * STATE_PLUS_LONGEST_TOKENS));
        assert_eq!(kind(r.jev.prepare(&r.file, long_job)), Kind::TooLong, "a job too long with one question");
        assert_eq!(r.store.reads(), 0);

        // At the cap, with difficulty counted among the questions, the ask goes ahead.
        assert!(r.jev.prepare(&r.file, route(MAX_QUESTIONS - 1, true)).is_ok());

        // The web view's budget test refuses this same route at the same job length
        // (`route` in src/domain/jevBudget.test.ts).
        let Ask::Route(asked) = Ask::parse(route(1, true)).unwrap() else {
            panic!("a route");
        };
        assert_eq!(tokens(&asked.questions["m1"]), 108);
        let with_job = |chars: usize| {
            let mut request = route(1, true);
            request["state"]["job"] = json!("x".repeat(chars));
            request
        };
        assert!(r.jev.prepare(&r.file, with_job(127_558)).is_ok());
        assert_eq!(kind(r.jev.prepare(&r.file, with_job(127_559))), Kind::TooLong);
    }

    #[test]
    fn two_replies_together_count_toward_a_head_to_heads_budget_at_the_web_views_sizes() {
        // The same request refuses at the same reply length in src/domain/jevBudget.test.ts.
        // Each reply alone is about half the 32k, so only the two together pass it.
        let r = rig_on();
        let Ask::HeadToHead(h) = Ask::parse(pair_for_budget(0)).unwrap() else {
            panic!("a head-to-head");
        };
        assert_eq!(tokens(&h.questions["a1"]), 26);
        assert_eq!(tokens(&h.state), 38);
        assert_eq!(kind(r.jev.prepare(&r.file, pair_for_budget(63_873))), Kind::TooLong);
        assert_eq!(r.store.reads(), 0);
        assert!(r.jev.prepare(&r.file, pair_for_budget(63_872)).is_ok());
        assert_eq!(r.store.reads(), 1);
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
