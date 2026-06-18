import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { ChatCommand } from "./cli/cmd/chat.js"
import { RunCommand } from "./cli/cmd/run.js"
import { UI } from "./cli/ui.js"

const cli = yargs(hideBin(process.argv))
  .scriptName("jianjicode")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", "0.1.0")
  .alias("version", "v")
  .usage("\n" + UI.logo())
  .command(RunCommand)
  .command(ChatCommand)
  .strict()

;(async () => {
  try {
    await cli.parse()
  } catch (e) {
    if (e instanceof Error) {
      UI.error(e.message)
    } else {
      UI.error(String(e))
    }
    process.exit(1)
  }
})()
