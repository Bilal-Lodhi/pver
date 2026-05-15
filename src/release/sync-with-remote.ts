import simpleGit, { SimpleGit } from "simple-git"
import { AppContext } from "../app-context"
import { configureOrigin } from "./configure-origin"

export const syncWithRemote = async (ctx: AppContext) => {
  console.log("Syncing with remote main")
  let git: SimpleGit = simpleGit(ctx.current_directory)

  const cleanup = await configureOrigin(git)

  // Pull main and rebase to sync with remote
  // This establishes the origin/main reference needed for workflows
  try {
    await git.pull("origin", "main", ["--rebase"])
  } catch (e: any) {
    if (e.toString().includes("unstaged changes")) {
      const status = await git.status()
      const changed_files = [
        ...status.not_added,
        ...status.created,
        ...status.deleted,
        ...status.modified,
        ...status.renamed.map((r) => r.to),
      ]
      if (changed_files.length) {
        console.error(
          "Cannot pull with rebase due to unstaged changes in the following files:"
        )
        for (const file of changed_files) {
          console.error(" -", file)
        }
      }
    }
    throw e
  } finally {
    if (cleanup) await cleanup()
  }
}
