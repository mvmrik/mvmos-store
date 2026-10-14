// Read Gemini CLI's own Code Assist quota without sending a model prompt.
// The CLI bundles these modules under versioned chunk names, so locate the
// bundle that exports its OAuth client and Code Assist server at runtime.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

const output = value => process.stdout.write('MVMAI_USAGE_JSON:' + JSON.stringify(value) + '\n');

try {
  const home = os.homedir();
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'settings.json'), 'utf8'));
  if (settings.security?.auth?.selectedType !== 'oauth-personal') {
    output({unmetered: true});
  } else {
    const entry = fs.realpathSync(process.argv[2]);
    const bundleDir = path.dirname(entry);
    const entryText = fs.readFileSync(entry, 'utf8');
    const chunks = [...entryText.matchAll(/["']\.\/(chunk-[\w-]+\.js)["']/g)].map(match => match[1]);
    let core;
    for (const name of new Set(chunks)) {
      const file = path.join(bundleDir, name);
      const code = fs.readFileSync(file, 'utf8');
      if (code.includes('getOauthClient,') && code.includes('CodeAssistServer,')) {
        core = await import(pathToFileURL(file).href);
        break;
      }
    }
    if (!core?.getOauthClient || !core?.CodeAssistServer || !core?.AuthType) {
      output({unavailable: true});
    } else {
      const config = {
        getProxy: () => undefined,
        isBrowserLaunchSuppressed: () => true,
        isInteractive: () => false,
      };
      const client = await core.getOauthClient(core.AuthType.LOGIN_WITH_GOOGLE, config);
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
      const server = new core.CodeAssistServer(client, projectId);
      const metadata = {ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI'};
      const account = await server.loadCodeAssist({
        cloudaicompanionProject: projectId,
        metadata: {...metadata, duetProject: projectId},
      });
      const project = account.cloudaicompanionProject || projectId;
      if (!project) {
        output({unavailable: true});
      } else {
        const quota = await server.retrieveUserQuota({project});
        output({buckets: (quota.buckets || []).filter(bucket =>
          typeof bucket.modelId === 'string' &&
          Number.isFinite(bucket.remainingFraction) &&
          bucket.remainingFraction >= 0 && bucket.remainingFraction <= 1
        ).slice(0, 40).map(bucket => ({
          model_id: bucket.modelId,
          remaining_fraction: bucket.remainingFraction,
          reset_time: bucket.resetTime || null,
        }))});
      }
    }
  }
} catch {
  output({unavailable: true});
}
