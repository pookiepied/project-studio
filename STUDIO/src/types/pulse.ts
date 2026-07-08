/**
 * Pulse card type system.
 *
 * Any Studio feature can push a typed card to the Pulse overlay via:
 *   overlayService.showCard(card: PulseCard)
 *
 * The card type drives which visual treatment is rendered.
 * Use "default" when no specialized layout exists yet.
 */

export type PulseCardType =
  | "default"          // generic — title + text, fallback for everything
  | "price-lookup"     // crypto/stock/forex price with change %
  | "web-search"       // search result title + snippet
  | "image-generation" // progress bar → image preview
  | "video-generation" // progress indicator
  | "ocr"              // text extracted from screen or image
  | "computer-use"     // screen action being performed
  | "memory"           // memory retrieved or stored
  | "mcp"              // MCP tool invocation result
  | "skill";           // skill execution output

export interface PulseCard {
  type: PulseCardType;
  /** Short label shown on the left of the card */
  title?: string;
  /** Primary content line */
  text?: string;
  /** Secondary info line — ticker, URL, timestamp, etc. */
  subtext?: string;
  /** 0-100, for in-progress states */
  progress?: number;
  /** Image URL — for image gen previews */
  imageUrl?: string;
  /**
   * Auto-dismiss delay in ms.
   * Default: 10000 (10s). Pass 0 to disable auto-dismiss.
   */
  autoDismissMs?: number;
}
