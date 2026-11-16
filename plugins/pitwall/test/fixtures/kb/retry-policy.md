# Retry policy for the payments client

The payments client retries failed calls with exponential backoff. The base delay comes from `RETRY_BACKOFF_MS` and the ceiling from `MAX_RETRY_ATTEMPTS`.

```kotlin
val delay = RETRY_BACKOFF_MS * 2.0.pow(attempt)
// a blank line inside a fence must not split the chunk

if (attempt >= MAX_RETRY_ATTEMPTS) throw GiveUpException()
```

Only idempotent requests are retried. Non-idempotent calls surface the error immediately.
