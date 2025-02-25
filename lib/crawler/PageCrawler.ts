import { Stagehand } from "..";
import { LogLine } from "../../types/log";

export interface CrawlResult {
  url: string;
  elements: ElementInfo[];
  timestamp: Date;
}

export interface ElementInfo {
  selector: string;
  description: string;
  type: string;
  attributes: Record<string, string>;
  text: string;
  isInteractive: boolean;
  position: {
    x: number;
    y: number;
  };
}

export class PageCrawler {
  private stagehand: Stagehand;
  private logger: (logLine: LogLine) => void;

  constructor(stagehand: Stagehand, logger: (logLine: LogLine) => void) {
    this.stagehand = stagehand;
    this.logger = logger;
  }

  /**
   * Crawls a page and extracts all relevant elements using processAllOfDom
   */
  public async crawlPage(url: string): Promise<CrawlResult> {
    this.logger({
      category: "crawler",
      message: `Starting crawl of ${url}`,
      level: 1,
    });

    await this.stagehand.page.goto(url);

    // Use processAllOfDom to get all elements systematically
    const { outputString, selectorMap } = await this.stagehand.page.evaluate(() => {
      return window.processAllOfDom();
    });

    // Parse the outputString to get element information
    const elements = await this.parseOutputString(this.stagehand, outputString, selectorMap);

    return {
      url,
      elements,
      timestamp: new Date()
    };
  }

  /**
   * Parses the outputString from processAllOfDom into structured ElementInfo objects
   */
  private async parseOutputString(
    page: Stagehand,
    outputString: string,
    selectorMap: Record<number, string[]>
  ): Promise<ElementInfo[]> {
    const elementInfos: ElementInfo[] = [];
    const lines = outputString.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        // Each line format is "index:elementHTML"
        const [indexStr] = line.split(':');
        const index = parseInt(indexStr);

        if (isNaN(index) || !selectorMap[index]) continue;

        // Get the xpath for this element
        const xpath = selectorMap[index][0];

        // Get detailed element information
        const info = await page.page.evaluate((xpath) => {
          const el = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          ).singleNodeValue as HTMLElement;

          if (!el) return null;

          const rect = el.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(el);

          // Parse the element type from the HTML string
          const tagMatch = el.outerHTML.match(/<([a-zA-Z0-9-]+)/);
          const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';

          return {
            type: tagName,
            attributes: Object.fromEntries(
              Array.from(el.attributes).map(attr => [attr.name, attr.value])
            ),
            text: el.textContent?.trim() || "",
            isInteractive: (
              tagName === "button" ||
              tagName === "a" ||
              tagName === "input" ||
              tagName === "select" ||
              tagName === "textarea" ||
              el.hasAttribute("onclick") ||
              el.hasAttribute("role") ||
              computedStyle.cursor === "pointer"
            ),
            position: {
              x: rect.x + window.scrollX,
              y: rect.y + window.scrollY
            }
          };
        }, xpath);

        if (info) {
          elementInfos.push({
            selector: `xpath=${xpath}`,
            description: this.generateDescription(info),
            ...info
          });
        }
      } catch (error) {
        this.logger({
          category: "crawler",
          message: "Error processing element",
          level: 1,
          auxiliary: {
            error: {
              value: error.message,
              type: "string"
            },
            line: {
              value: line,
              type: "string"
            }
          }
        });
      }
    }

    return elementInfos;
  }

  /**
   * Generates a human-readable description of the element based on its properties
   */
  private generateDescription(info: {
    type: string;
    attributes: Record<string, string>;
    text: string;
    isInteractive: boolean;
  }): string {
    const parts: string[] = [];

    // Add element type
    parts.push(info.type);

    // Add important attributes
    if (info.attributes["id"]) {
      parts.push(`with id "${info.attributes["id"]}"`);
    }
    if (info.attributes["name"]) {
      parts.push(`named "${info.attributes["name"]}"`);
    }
    if (info.attributes["placeholder"]) {
      parts.push(`with placeholder "${info.attributes["placeholder"]}"`);
    }
    if (info.attributes["aria-label"]) {
      parts.push(`labeled "${info.attributes["aria-label"]}"`);
    }
    if (info.attributes["role"]) {
      parts.push(`with role "${info.attributes["role"]}"`);
    }

    // Add text content if present
    if (info.text) {
      parts.push(`containing "${info.text.substring(0, 50)}${info.text.length > 50 ? '...' : ''}"`);
    }

    return parts.join(' ');
  }
} 