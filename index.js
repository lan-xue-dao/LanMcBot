;(async () => {
  const { default: config } = await import('./lib/config.mjs')

  const argTui = process.argv.includes('--tui')
  const argCli = process.argv.includes('--cli')
  const wantTui = argTui || (!argCli && config.ui === 'tui')

  if (wantTui) {
    await import('./tui.mjs')
  } else {
    await import('./cli.mjs')
  }
})()
