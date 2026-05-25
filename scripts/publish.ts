// Trigger a JSR publish by creating and pushing a `v<version>` tag.
//
// The actual `deno publish` invocation happens inside the GitHub Actions
// workflow at `.github/workflows/publish.yml`, where the OIDC token is
// available and JSR will stamp the release with provenance.
//
// Running `deno publish` from a developer workstation would succeed but
// produce a release with no provenance, which is why this task pushes a
// tag instead of calling `deno publish` directly.

const denoJson = JSON.parse(await Deno.readTextFile("deno.json")) as { version: string };
const version = denoJson.version;
if (!version) {
  console.error("deno.json is missing a `version` field");
  Deno.exit(1);
}

const tag = `v${version}`;

async function run(cmd: string[]): Promise<string> {
  const p = new Deno.Command(cmd[0]!, {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  if (code !== 0) {
    console.error(new TextDecoder().decode(stderr));
    throw new Error(`Command failed (${code}): ${cmd.join(" ")}`);
  }
  return new TextDecoder().decode(stdout).trim();
}

const status = await run(["git", "status", "--porcelain"]);
if (status.length > 0) {
  console.error("Working tree is dirty. Commit or stash changes before publishing:");
  console.error(status);
  Deno.exit(1);
}

const existing = await run(["git", "tag", "--list", tag]);
if (existing.length > 0) {
  console.error(`Tag ${tag} already exists. Bump the version in deno.json and try again.`);
  Deno.exit(1);
}

console.log(`Tagging ${tag} and pushing to origin to trigger the JSR publish workflow...`);
await run(["git", "tag", "-a", tag, "-m", `Release ${tag}`]);
await run(["git", "push", "origin", tag]);
console.log(`Pushed ${tag}. Watch the publish workflow at:`);
console.log("  https://github.com/jrmarcum/wabt-ts/actions/workflows/publish.yml");
