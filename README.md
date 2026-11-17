## Deployment

Images are built, scanned, signed and attested on `main`. The `deploy` job verifies the
provenance and signature (signer `sign.yml`) and rolls the verified digest out to ECS
after a manual approval. It only runs when the repository variable `DEPLOY_ENABLED` is `true`.
