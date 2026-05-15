/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict"
import {
  getGithubToken,
  normalizeGithubRemoteUrl,
  addGithubTokenToRemoteUrl,
  configureOrigin,
} from "../src/release/configure-origin"

// ---------------------------------------------------------------------------
// Unit tests: getGithubToken
// ---------------------------------------------------------------------------

assert.equal(
  getGithubToken({
    GITHUB_TOKEN: "github-token",
    PVER_GITHUB_TOKEN: " pver-token ",
  }),
  "pver-token",
  "PVER_GITHUB_TOKEN should take precedence over GITHUB_TOKEN"
)

assert.equal(
  getGithubToken({ GITHUB_TOKEN: " github-token " }),
  "github-token",
  "GITHUB_TOKEN should remain the default token"
)

assert.equal(
  getGithubToken({}),
  undefined,
  "getGithubToken should return undefined when no tokens are set"
)

// ---------------------------------------------------------------------------
// Unit tests: normalizeGithubRemoteUrl
// ---------------------------------------------------------------------------

assert.equal(
  normalizeGithubRemoteUrl("git@github.com:tscircuit/pver.git"),
  "https://github.com/tscircuit/pver.git",
  "SSH remote (git@github.com:owner/repo.git) should normalize to HTTPS"
)

assert.equal(
  normalizeGithubRemoteUrl("ssh://git@github.com/tscircuit/pver.git"),
  "https://github.com/tscircuit/pver.git",
  "SSH remote (ssh://git@github.com/owner/repo.git) should normalize to HTTPS"
)

assert.equal(
  normalizeGithubRemoteUrl("https://github.com/tscircuit/pver.git\n"),
  "https://github.com/tscircuit/pver.git",
  "HTTPS remote with trailing newline should be trimmed"
)

assert.equal(
  normalizeGithubRemoteUrl(
    "https://oauth2:old-token@github.com/tscircuit/pver.git"
  ),
  "https://github.com/tscircuit/pver.git",
  "Already-authenticated HTTPS remote should have credentials stripped"
)

assert.equal(
  normalizeGithubRemoteUrl(
    "https://x-access-token:ghs_123abc@github.com/tscircuit/pver.git"
  ),
  "https://github.com/tscircuit/pver.git",
  "x-access-token authenticated remote should have credentials stripped"
)

// NEW: Test that unencoded @ in userinfo is correctly stripped (the WHATWG
// URL parser handles this where simple regexes would fail)
assert.equal(
  normalizeGithubRemoteUrl(
    "https://token:with@unencoded@github.com/tscircuit/pver.git"
  ),
  "https://github.com/tscircuit/pver.git",
  "Credentials containing unencoded @ symbols should be fully stripped"
)

// NEW: Test that simple credentials at the very end work too
assert.equal(
  normalizeGithubRemoteUrl("https://user:pass@github.com/owner/repo.git"),
  "https://github.com/owner/repo.git",
  "Standard user:pass@ credentials should be stripped"
)

// ---------------------------------------------------------------------------
// Unit tests: addGithubTokenToRemoteUrl
// ---------------------------------------------------------------------------

assert.equal(
  addGithubTokenToRemoteUrl(
    "git@github.com:tscircuit/pver.git",
    "test-token"
  ),
  "https://oauth2:test-token@github.com/tscircuit/pver.git",
  "SSH remotes should be converted to authenticated HTTPS remotes"
)

assert.equal(
  addGithubTokenToRemoteUrl(
    "ssh://git@github.com/tscircuit/pver.git",
    "test-token"
  ),
  "https://oauth2:test-token@github.com/tscircuit/pver.git",
  "ssh:// remotes should be converted to authenticated HTTPS remotes"
)

assert.equal(
  addGithubTokenToRemoteUrl(
    "https://github.com/tscircuit/pver.git\n",
    "test-token"
  ),
  "https://oauth2:test-token@github.com/tscircuit/pver.git",
  "HTTPS remotes should receive the token and be trimmed"
)

assert.equal(
  addGithubTokenToRemoteUrl(
    "https://github.com/tscircuit/pver.git",
    "token:with@symbols"
  ),
  "https://oauth2:token%3Awith%40symbols@github.com/tscircuit/pver.git",
  "tokens should be URL-encoded before they are added to origin"
)

assert.equal(
  addGithubTokenToRemoteUrl(
    "https://github.com/tscircuit/pver.git",
    "github_pat_11ABCXYZZZ_test/value+extra"
  ),
  "https://oauth2:github_pat_11ABCXYZZZ_test%2Fvalue%2Bextra@github.com/tscircuit/pver.git",
  "complex PAT tokens with slashes and plus signs should be URL-encoded"
)

assert.equal(
  addGithubTokenToRemoteUrl(
    "https://oauth2:old-token@github.com/tscircuit/pver.git",
    "test-token"
  ),
  "https://oauth2:test-token@github.com/tscircuit/pver.git",
  "already-authenticated remotes should be re-authenticated with the new token"
)

// ---------------------------------------------------------------------------
// Integration tests: configureOrigin
// ---------------------------------------------------------------------------

type RawCall = {
  args: string[]
}

function createMockGit(initial_url: string) {
  let current_url = initial_url
  const raw_calls: RawCall[] = []

  return {
    remote: async (args: string[]) => {
      return `${current_url}\n`
    },
    raw: async (args: string[]) => {
      raw_calls.push({ args })
      if (args[0] === "remote" && args[1] === "set-url") {
        current_url = args[3]
      }
      return ""
    },
    getRawCalls: () => raw_calls,
    getCurrentUrl: () => current_url,
  }
}

async function withEnv(
  env: Record<string, string | undefined>,
  run: () => Promise<void>
) {
  const original: Record<string, string | undefined> = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    PVER_GITHUB_TOKEN: process.env.PVER_GITHUB_TOKEN,
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    await run()
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

async function runConfigureOriginTests() {
  // Test 1: PVER_GITHUB_TOKEN takes precedence and cleanup restores origin
  await withEnv(
    {
      GITHUB_TOKEN: "github-token",
      PVER_GITHUB_TOKEN: " pver-token ",
    },
    async () => {
      const git = createMockGit("git@github.com:tscircuit/pver.git")

      const cleanup = await configureOrigin(git)

      assert.ok(cleanup, "configureOrigin should return a cleanup function")
      assert.equal(
        git.getCurrentUrl(),
        "https://oauth2:pver-token@github.com/tscircuit/pver.git",
        "configureOrigin should rewrite SSH origin using PVER_GITHUB_TOKEN"
      )

      // Verify set-url was used (not removeRemote + addRemote)
      const raw_calls = git.getRawCalls()
      assert.deepEqual(
        raw_calls[0].args,
        ["remote", "set-url", "origin", "https://oauth2:pver-token@github.com/tscircuit/pver.git"],
        "configureOrigin should use git remote set-url, preserving custom refspecs"
      )

      // Verify cleanup restores the original URL
      if (cleanup) await cleanup()

      assert.equal(
        git.getCurrentUrl(),
        "https://github.com/tscircuit/pver.git",
        "cleanup should restore the unauthenticated origin URL"
      )
    }
  )

  // Test 2: No-op when no tokens are set
  await withEnv(
    {
      GITHUB_TOKEN: undefined,
      PVER_GITHUB_TOKEN: undefined,
    },
    async () => {
      const git = createMockGit("https://github.com/tscircuit/pver.git")

      const cleanup = await configureOrigin(git)

      assert.equal(cleanup, undefined, "configureOrigin should return undefined when no token is set")
      assert.deepEqual(
        git.getRawCalls(),
        [],
        "configureOrigin should not execute any git commands when no token is set"
      )
    }
  )

  // Test 3: Leave already-authenticated origins alone when URL wouldn't change
  await withEnv(
    {
      GITHUB_TOKEN: "new-token",
      PVER_GITHUB_TOKEN: undefined,
    },
    async () => {
      const git = createMockGit(
        "https://oauth2:new-token@github.com/tscircuit/pver.git"
      )

      const cleanup = await configureOrigin(git)

      assert.equal(cleanup, undefined, "configureOrigin should return undefined when URL is already correct")
      assert.deepEqual(
        git.getRawCalls(),
        [],
        "configureOrigin should leave already-up-to-date origins alone"
      )
    }
  )

  // Test 4: GITHUB_TOKEN fallback when PVER_GITHUB_TOKEN is not set
  await withEnv(
    {
      GITHUB_TOKEN: "fallback-token",
      PVER_GITHUB_TOKEN: undefined,
    },
    async () => {
      const git = createMockGit("git@github.com:owner/repo.git")

      const cleanup = await configureOrigin(git)

      assert.ok(cleanup, "configureOrigin should return a cleanup function")
      assert.equal(
        git.getCurrentUrl(),
        "https://oauth2:fallback-token@github.com/owner/repo.git",
        "configureOrigin should fall back to GITHUB_TOKEN when PVER_GITHUB_TOKEN is not set"
      )

      if (cleanup) await cleanup()

      assert.equal(
        git.getCurrentUrl(),
        "https://github.com/owner/repo.git",
        "cleanup should restore the original URL"
      )
    }
  )

  // Test 5: Credential stripping handles unencoded @ in userinfo
  await withEnv(
    {
      GITHUB_TOKEN: "clean-token",
      PVER_GITHUB_TOKEN: undefined,
    },
    async () => {
      const git = createMockGit(
        "https://token:with@unencoded@github.com/owner/repo.git"
      )

      const cleanup = await configureOrigin(git)

      assert.ok(cleanup, "configureOrigin should handle URLs with unencoded @ in credentials")
      assert.equal(
        git.getCurrentUrl(),
        "https://oauth2:clean-token@github.com/owner/repo.git",
        "URLs with unencoded @ in credentials should be handled correctly"
      )

      if (cleanup) await cleanup()
    }
  )

  // Test 6: configureOrigin only calls raw once (no redundant operations)
  await withEnv(
    {
      GITHUB_TOKEN: "token",
      PVER_GITHUB_TOKEN: undefined,
    },
    async () => {
      const git = createMockGit("https://github.com/owner/repo.git")

      const cleanup = await configureOrigin(git)

      assert.ok(cleanup, "configureOrigin should return a cleanup function")
      assert.equal(
        git.getRawCalls().length,
        1,
        "configureOrigin should make exactly one git raw call (set-url) when URL needs updating"
      )
    }
  )
}

runConfigureOriginTests()
  .then(() => {
    console.log("configure-origin tests passed")
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })