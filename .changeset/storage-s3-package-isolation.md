---
"@dinilmusick/gutts": patch
---

Publish the isolated S3 storage entrypoint as part of the public package artifact. The release includes the dedicated `./storage/s3` JavaScript and declaration files, allowing S3-only consumers to import the AWS-backed provider without loading the aggregate storage module or `googleapis`.
