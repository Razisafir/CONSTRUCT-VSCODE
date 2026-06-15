# Kovix Privacy Policy

**Last updated: June 2026**

## Data Collection

Kovix does **not collect any data by default**. No telemetry, no usage analytics, no crash reports, and no personal information is transmitted to any server unless you explicitly opt in.

### Telemetry

All Microsoft telemetry systems (1DS, Application Insights) have been disabled in this fork. The telemetry setting is off by default and there is no prompt to enable it. If you choose to enable telemetry through settings, only minimal anonymous usage data would be sent — but this is not the default configuration.

## AI Features

Kovix includes AI capabilities that may transmit data under certain conditions:

### Local AI (Ollama, LM Studio, Xenova Transformers.js)

When using local AI providers, **no data leaves your machine**. All inference runs locally on your hardware. Your code, conversations, and prompts stay entirely on your device.

### Cloud AI (Anthropic, OpenAI, or other API providers)

When you configure a cloud AI provider (e.g., Anthropic Claude, OpenAI GPT), the following data is sent to that provider's API:

- The content of your chat messages to the agent
- Any file content the agent reads as context
- Terminal command output that the agent processes
- Workspace context injected into conversations (via semantic memory)

**This data transmission is controlled entirely by you.** Cloud AI features are only active if you explicitly configure an API key and select a cloud provider. No API keys are pre-configured, and the default provider is Ollama (local).

### API Key Storage

API keys are stored in your operating system's secure credential storage (OS keychain on macOS, Credential Manager on Windows, libsecret on Linux). Keys are never stored in plaintext configuration files or transmitted to any Kovix server.

## MCP Servers

If you configure MCP (Model Context Protocol) servers, those servers may receive data from the agent depending on the tools they provide. This is controlled by your MCP server configuration and is outside Kovix's data handling. Review the privacy policy of each MCP server you connect.

## Extensions

Extensions installed from the Open VSX Registry or other sources have their own data handling policies. Kovix does not mediate data collection by installed extensions. Review each extension's privacy practices before installation.

## Contact

For privacy questions or concerns, please open an issue on GitHub: https://github.com/Razisafir/KOVIX/issues

## GDPR Compliance (European Union)

Kovix is designed with GDPR principles in mind. Because Kovix does not collect personal data by default, most GDPR obligations (such as the right to access, rectify, or erase personal data) do not apply to the default product configuration. If you choose to enable telemetry or use cloud AI features, the following applies:

- **Data Controller**: Razisafir is the data controller for any telemetry data you opt into sharing. Cloud AI providers (Anthropic, OpenAI, etc.) act as independent data controllers for data you send to their APIs.
- **Legal Basis**: Where telemetry is enabled, processing is based on your explicit consent (Article 6(1)(a) GDPR). You may withdraw consent at any time by disabling telemetry in settings.
- **Data Subject Rights**: You have the right to access, rectify, erase, restrict, and port any personal data we process. To exercise these rights, contact us via the GitHub issues link above.
- **Data Retention**: Telemetry data, if enabled, is retained for no longer than 90 days. Cloud AI provider data retention is governed by each provider's privacy policy.
- **International Transfers**: Cloud AI API calls may involve data transfers outside the EEA. By configuring a cloud AI provider, you acknowledge this possibility.
- **DPO Contact**: For GDPR-related inquiries, open a GitHub issue with the label "gdpr."

## CCPA Compliance (California, USA)

Under the California Consumer Privacy Act (CCPA), California residents have the right to know what personal information is collected, to delete it, to opt out of its sale, and to not be discriminated against for exercising these rights. Because Kovix does not collect personal information by default, and we do not sell any personal information, these rights are inherently protected. If you enable telemetry:

- **Right to Know**: You can request a summary of data collected by opening a GitHub issue.
- **Right to Delete**: You can request deletion of any telemetry data by opening a GitHub issue.
- **Right to Opt Out**: Telemetry can be disabled at any time in Kovix settings.
- **No Sale of Data**: We do not sell, rent, or share personal information with third parties for advertising or commercial purposes.

## Children's Privacy

Kovix is not intended for use by children under the age of 13. We do not knowingly collect personal information from children under 13.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be posted on this page with an updated revision date. Continued use of Kovix after changes constitutes acceptance of the revised policy.
