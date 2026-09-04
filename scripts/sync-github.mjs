import { spawnSync } from "node:child_process";

const remote = "github";
const branch = "main";
const oauthClientId = "178c6fc778ccc68e1d6a";
const oauthScope = process.env.GITHUB_SYNC_SCOPE || "public_repo";

function die(message) {
  console.error(`GitHub sync: ${message}`);
  process.exit(1);
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: options.stdio || "pipe",
    env: options.env || process.env,
  });
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    die(`git ${args[0]} failed.`);
  }
  return result.stdout?.trim() || "";
}

async function formPost(url, values) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(values),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) die(`${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function waitForResume() {
  if (!process.stdin.isTTY) {
    die("run interactively so synchronization can pause for device authorization.");
  }
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));
  process.stdin.pause();
}

git(["rev-parse", "--show-toplevel"]);
if (git(["branch", "--show-current"]) !== branch) die(`switch to ${branch} first.`);
if (git(["status", "--porcelain"])) die("commit or stash local changes first.");

const remoteUrl = git(["remote", "get-url", remote]);
if (!remoteUrl.startsWith("https://github.com/")) {
  die(`remote '${remote}' must use GitHub HTTPS.`);
}

console.log(`Checking ${remote}/${branch}...`);
git(["fetch", "--quiet", remote, branch]);
const localSha = git(["rev-parse", branch]);
const initialRemoteSha = git(["rev-parse", "FETCH_HEAD"]);

if (localSha === initialRemoteSha) {
  console.log(`GitHub is already synchronized at ${localSha}.`);
  process.exit(0);
}

const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", initialRemoteSha, localSha]);
if (ancestor.status !== 0) {
  die(`${remote}/${branch} has diverged; resolve it manually instead of forcing.`);
}

const device = await formPost("https://github.com/login/device/code", {
  client_id: oauthClientId,
  scope: oauthScope,
});
if (!device.device_code || !device.user_code || !device.verification_uri) {
  die("GitHub returned an invalid device authorization response.");
}

console.log(`Open ${device.verification_uri} and enter: ${device.user_code}`);
console.log("Waiting for an explicit resume after authorization...");
await waitForResume();

let interval = Number(device.interval || 5);
const deadline = Date.now() + Number(device.expires_in || 900) * 1000;
let accessToken = "";

while (Date.now() < deadline) {
  const token = await formPost("https://github.com/login/oauth/access_token", {
    client_id: oauthClientId,
    device_code: device.device_code,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (token.access_token) {
    accessToken = token.access_token;
    break;
  }
  if (token.error === "slow_down") interval += 5;
  else if (token.error !== "authorization_pending") {
    die(token.error_description || token.error || "device authorization failed.");
  }
  await new Promise((resolve) => setTimeout(resolve, interval * 1000));
}

if (!accessToken) die("device authorization expired.");

const credentialHelper =
  '!f() { if [ "$1" = get ]; then printf "%s\\n" "username=x-access-token" "password=$GITHUB_SYNC_TOKEN"; fi; }; f';
console.log(`Authorization complete. Pushing ${branch}...`);
git(
  [
    "-c",
    "credential.helper=",
    "-c",
    `credential.helper=${credentialHelper}`,
    "push",
    remote,
    `${branch}:${branch}`,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GITHUB_SYNC_TOKEN: accessToken,
    },
  },
);
accessToken = "";

const finalRemoteSha = git(["ls-remote", "--heads", remote, branch]).split(/\s+/)[0];
if (finalRemoteSha !== localSha) die("push finished, but the remote SHA does not match.");

console.log(`GitHub synchronized successfully at ${localSha}.`);
