---
"@dinilmusick/gutts": minor
---

Expose the provider-specific `./storage/s3` package entrypoint as a supported public import with its emitted JavaScript and declaration files. This additive API lets S3-only consumers load the AWS-backed provider without loading the aggregate storage module or `googleapis`.
