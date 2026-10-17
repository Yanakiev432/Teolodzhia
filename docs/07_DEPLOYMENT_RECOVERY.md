# 07. Deployment and recovery

## Frozen stack

- Apps Script source: backend/apps-script/Teolodzhia_Corpus_API_v2_3.gs
- Apps Script production behavior: version 12
- Worker source: backend/cloudflare/cloudflare_worker_teolodzhia_v1_6.js
- OpenAPI: config/custom-gpt/openapi-v2.3.1.yaml
- Instructions: config/custom-gpt/INSTRUCTIONS_v2.3.1.txt

## Recovery order

1. Restore/verify Google Drive index separately.
2. Deploy Apps Script while preserving deployment URL and secret handling.
3. Preserve version-12-equivalent gzip ContentType behavior.
4. Deploy Worker v1.6 preserving its secrets.
5. Verify https://teolodzhia-library-proxy.yanakiev-ivan.workers.dev/health.
6. Configure the Custom GPT Action with frozen OpenAPI.
7. Configure API Key authentication in the Custom GPT UI.
8. Apply frozen Instructions.
9. Run acceptance from docs/08_VALIDATION_ACCEPTANCE.md.

## External state not stored here

- corpus contents
- Google ownership/permissions
- API key values
- Cloudflare secrets
- OAuth tokens
- Custom GPT ownership/visibility controls
