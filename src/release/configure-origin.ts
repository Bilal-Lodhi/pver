/**
 * Configures the git origin remote URL to include a GitHub token so that
 * pver can push commits and tags to protected branches.
 *
 * Prefers PVER_GITHUB_TOKEN (a PAT or GitHub App installation token that
 * can bypass branch-protection rules) and falls back to the default
 * GITHUB_TOKEN for non-protected branches.
 *
 * Returns an optional cleanup function that restores the original
 * unauthenticated URL, preventing long-lived token leakage in .git/config.
 * Callers MUST invoke the cleanup after their git operations complete.
 */

export const getGithubToken = (
  env: NodeJS.ProcessEnv = process.env
): string | undefined =>
  env.PVER_GITHUB_TOKEN?.trim() || env.GITHUB_TOKEN?.trim()

/**
 * Normalize SSH and other GitHub remote URL formats to a clean HTTPS URL.
 * Also strips any pre-existing embedded credentials so we can safely
 * re-authenticate.
 *
 * Uses the WHATWG URL parser to robustly strip credentials even when the
 * userinfo component contains unencoded @ characters (a common bug in
 * competitor implementations that used simple regexes like [^@]+).
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

  // Robust credential stripping using the WHATWG URL parser.
  // Unlike simple regexes (e.g. /[^@]+/), this correctly handles
  // malformed tokens containing unencoded @ symbols in userinfo.
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) {
      // Reconstruct without credentials — avoids the trailing @ that
      // setting username="" / password="" would produce
      url = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`
    }
  } catch {
    // If URL parsing fails (extremely malformed), fall back to a
    // greedy regex that matches up to the *last* @ before github.com
    url = url.replace(/^https:\/\/.*@github\.com\//, "https://github.com/")
  }

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

  const encoded_token = encodeURIComponent(github_token.trim())

  return normalized.replace(
    "https://github.com/",
    `https://oauth2:${encoded_token}@github.com/`
  )
}

/**
 * Rewrites the git origin remote to include an authentication token.
 *
 * Uses `git remote set-url` (instead of removeRemote + addRemote) to
 * preserve any custom per-remote configuration the user may have set
 * (e.g. fetch refspecs, push URLs, tags).
 *
 * Returns an optional cleanup function. Callers MUST invoke it after
 * their git push/pull operations complete so the token is not left
 * exposed in .git/config indefinitely.
 */
export const configureOrigin = async (
  git: any
): Promise<(() => Promise<void>) | undefined> => {
  const github_token = getGithubToken()

  if (!github_token) return undefined

  const remote_url = String(await git.remote(["get-url", "origin"]))
  const trimmed_url = remote_url.trim().replace(/\n/g, "")
  const new_url = addGithubTokenToRemoteUrl(remote_url, github_token)
  const original_url = normalizeGithubRemoteUrl(remote_url)

  if (new_url !== trimmed_url) {
    // Use set-url to update the URL in place, preserving custom refspecs etc.
    await git.raw(["remote", "set-url", "origin", new_url])

    // Return a cleanup function that restores the original unauthenticated URL
    return async () => {
      await git.raw(["remote", "set-url", "origin", original_url])
    }
  }

  return undefined
}
