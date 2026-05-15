/**
 * Configures the git origin remote URL to include a GitHub token so that
 * pver can push commits and tags to protected branches.
 *
 * Prefers PVER_GITHUB_TOKEN (a PAT or GitHub App installation token that
 * can bypass branch-protection rules) and falls back to the default
 * GITHUB_TOKEN for non-protected branches.
 */

export const getGithubToken = (
  env: NodeJS.ProcessEnv = process.env
): string | undefined =>
  env.PVER_GITHUB_TOKEN?.trim() || env.GITHUB_TOKEN?.trim()

/**
 * Normalize SSH and other GitHub remote URL formats to a clean HTTPS URL.
 * Also strips any pre-existing embedded credentials so we can safely re-authenticate.
 */
export const normalizeGithubRemoteUrl = (remote_url: string): string => {
  let url = remote_url.trim().replace(/\n/g, "")

  // Convert SSH formats to HTTPS
  // git@github.com:owner/repo.git → https://github.com/owner/repo.git
  const sshMatch = url.match(
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>.+?)(?:\.git)?$/
  )
  if (sshMatch?.groups) {
    return `https://github.com/${sshMatch.groups.owner}/${sshMatch.groups.repo}.git`
  }

  // ssh://git@github.com/owner/repo.git → https://github.com/owner/repo.git
  const sshUrlMatch = url.match(
    /^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<repo>.+?)(?:\.git)?$/
  )
  if (sshUrlMatch?.groups) {
    return `https://github.com/${sshUrlMatch.groups.owner}/${sshUrlMatch.groups.repo}.git`
  }

  // Strip pre-existing embedded credentials so we never double-authenticate
  // https://oauth2:old-token@github.com/... → https://github.com/...
  // https://x-access-token:old-token@github.com/... → https://github.com/...
  url = url.replace(/^https:\/\/[^@]+@github\.com\//, "https://github.com/")

  return url
}

/**
 * Injects an oauth2 token into a GitHub HTTPS remote URL.
 * Only modifies GitHub URLs. The token is URL-encoded to prevent breakage
 * from special characters.
 */
export const addGithubTokenToRemoteUrl = (
  remote_url: string,
  github_token: string
): string => {
  const normalized = normalizeGithubRemoteUrl(remote_url)

  if (!normalized.startsWith("https://github.com/")) {
    // Not a GitHub URL — don't modify
    return remote_url.trim().replace(/\n/g, "")
  }

  const encodedToken = encodeURIComponent(github_token.trim())

  return normalized.replace(
    "https://github.com/",
    `https://oauth2:${encodedToken}@github.com/`
  )
}

export const configureOrigin = async (git: any) => {
  const github_token = getGithubToken()

  if (!github_token) return

  const remote_url = String(await git.remote(["get-url", "origin"]))
  const new_url = addGithubTokenToRemoteUrl(remote_url, github_token)

  if (new_url !== remote_url.trim().replace(/\n/g, "")) {
    await git.removeRemote("origin")
    await git.addRemote("origin", new_url)
  }
}