export interface JobReport { readonly id: string; readonly state: string; readonly command: string }

/** Both native command jobs and native media jobs use this summary grammar. */
export function jobReports(output: string): JobReport[] {
  return output.split('\n').flatMap((line) => {
    const match = line.match(/^(\S+) {2}(running|queued|generating|finished|done|stopped|failed(?: to start(?:: .+?)?)?|exited -?\d+|exited \?) {2}(.+)$/)
    return match === null ? [] : [{ id: match[1] ?? '', state: match[2] ?? '', command: match[3] ?? '' }]
  })
}
