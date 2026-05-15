import simpleGit, { SimpleGit } from "simple-git"
import { AppContext } from "../app-context"
import { configureOrigin } from "./configure-origin"

export const pushToMain = async (ctx: AppContext) => {
  console.log("Pushing to main")
  let git: SimpleGit = simpleGit(ctx.current_directory)

  const cleanup = await configureOrigin(git)

  try {
    await git.push(["origin", `HEAD:${process.env.GITHUB_REF ?? "main"}`])
  } finally {
    if (cleanup) await cleanup()
  }
}
