/**
 * Copied verbatim from STUDIO/src/app/shell/shellConfig.ts
 */
export const SHELL = {
  windowRadius: 20,
  framePadding: 8,
  panelGap: 8,
  panelRadius: 12,
  titleBar: {
    height: 40,
    paddingLeft: 12,
    paddingRight: 10,
  },
  trafficLight: { size: 11, gap: 8 },
  sidebar: {
    defaultWidth: 256,
    minWidth: 200,
    maxWidth: 420,
  },
  contextPanel: {
    defaultWidth: 296,
    minWidth: 240,
    maxWidth: 460,
  },
  resizeHandle: { hitWidth: 10 },
  contentGutter: 24,
} as const
