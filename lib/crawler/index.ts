import { Stagehand } from "..";
import { LogLine } from "../../types/log";
import { PageCrawler, CrawlResult } from "./PageCrawler";
import { ActionAnalyzer, UserAction } from "./ActionAnalyzer";
import { LLMActionAnalyzer } from "./LLMActionAnalyzer";
import { LLMClient } from "../llm/LLMClient";
import * as fs from 'fs';
import * as path from 'path';

/**
 * Main crawler function that crawls a URL and identifies user actions
 */
export async function crawlUrl(
  stagehand: Stagehand, 
  url: string,
  options: {
    outputDir?: string;
    logger?: (logLine: LogLine) => void;
    analyzeActions?: boolean;
    useLLM?: boolean;
    llmClient?: LLMClient;
  } = {}
): Promise<{
  crawlResult: CrawlResult;
  userActions?: UserAction[];
}> {
  const logger = options.logger || ((logLine: LogLine) => {
    console.log(`[${logLine.category || 'crawler'}] ${logLine.message}`);
  });

  logger({
    category: "crawler",
    message: `Starting crawl of ${url}`,
    level: 1,
  });

  // Create the crawler
  const crawler = new PageCrawler(stagehand, logger);
  
  // Crawl the page
  const crawlResult = await crawler.crawlPage(url);
  
  // Analyze actions if requested
  let userActions: UserAction[] | undefined;
  if (options.analyzeActions !== false) {
    if (options.useLLM && options.llmClient) {
      // Use LLM-based analyzer
      const llmAnalyzer = new LLMActionAnalyzer(options.llmClient, logger);
      userActions = await llmAnalyzer.analyzeActions(crawlResult);
    } else {
      // Use rule-based analyzer
      const analyzer = new ActionAnalyzer(logger);
      userActions = analyzer.analyzeActions(crawlResult);
    }
    
    logger({
      category: "crawler",
      message: `Identified ${userActions?.length || 0} user actions`,
      level: 1,
    });
  }
  
  // Save the results if an output directory is specified
  if (options.outputDir) {
    await saveResults(crawlResult, userActions, options.outputDir);
    logger({
      category: "crawler",
      message: `Saved crawl results to ${options.outputDir}`,
      level: 1,
    });
  }
  
  return {
    crawlResult,
    userActions
  };
}

/**
 * Saves crawl results and user actions to disk
 */
async function saveResults(
  crawlResult: CrawlResult, 
  userActions: UserAction[] | undefined, 
  outputDir: string
): Promise<void> {
  // Create the output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Create a sanitized filename from the URL
  const urlObj = new URL(crawlResult.url);
  const sanitizedHost = urlObj.hostname.replace(/[^a-z0-9]/gi, '_');
  const sanitizedPath = urlObj.pathname.replace(/[^a-z0-9]/gi, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Save crawl results
  const crawlFilename = `${sanitizedHost}${sanitizedPath}_crawl_${timestamp}.json`;
  const crawlOutputPath = path.join(outputDir, crawlFilename);
  
  fs.writeFileSync(
    crawlOutputPath, 
    JSON.stringify(crawlResult, null, 2)
  );
  
  // Save user actions if available
  if (userActions && userActions.length > 0) {
    const actionsFilename = `${sanitizedHost}${sanitizedPath}_actions_${timestamp}.json`;
    const actionsOutputPath = path.join(outputDir, actionsFilename);
    
    fs.writeFileSync(
      actionsOutputPath, 
      JSON.stringify(userActions, null, 2)
    );
  }
}

/**
 * Crawls multiple URLs in sequence and identifies user actions
 */
export async function crawlUrls(
  stagehand: Stagehand,
  urls: string[],
  options: {
    outputDir?: string;
    logger?: (logLine: LogLine) => void;
    analyzeActions?: boolean;
  } = {}
): Promise<Array<{
  crawlResult: CrawlResult;
  userActions?: UserAction[];
}>> {
  const results: Array<{
    crawlResult: CrawlResult;
    userActions?: UserAction[];
  }> = [];
  
  for (const url of urls) {
    try {
      const result = await crawlUrl(stagehand, url, options);
      results.push(result);
    } catch (error) {
      options.logger?.({
        category: "crawler",
        message: `Error crawling ${url}: ${error.message}`,
        level: 1,
        auxiliary: {
          error: {
            value: error.message,
            type: "string"
          },
          trace: {
            value: error.stack,
            type: "string"
          }
        }
      });
    }
  }
  
  return results;
}

/**
 * Example usage:
 * 
 * import { Stagehand } from "../index";
 * import { crawlUrl } from "./crawler";
 * 
 * async function main() {
 *   const stagehand = await Stagehand.launch();
 *   const page = await stagehand.newPage();
 *   
 *   const { crawlResult, userActions } = await crawlUrl(page, "https://example.com", {
 *     outputDir: "./crawl-results",
 *     analyzeActions: true
 *   });
 *   
 *   console.log(`Crawled ${crawlResult.elements.length} elements`);
 *   console.log(`Identified ${userActions?.length || 0} user actions`);
 *   
 *   await stagehand.close();
 * }
 * 
 * main().catch(console.error);
 */ 