import { Stagehand } from "../lib";
import { crawlUrl } from "../lib/crawler";
import { ActionStorage, VectorDBClient } from "../lib/crawler/ActionStorage";
import { OpenAIClient } from "../lib/llm/OpenAIClient";
import { LogLine } from "../types/log";
import * as dotenv from "dotenv";
import { UserAction } from "../lib/crawler/LLMActionAnalyzer";
import { URL } from "url";

// Load environment variables from .env file
dotenv.config();

// Simple in-memory vector database for testing
class InMemoryVectorDB implements VectorDBClient {
  private vectors: Map<string, { vector: number[], metadata: Record<string, unknown> }> = new Map();

  async storeVector(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void> {
    this.vectors.set(id, { vector, metadata });
    console.log(`Stored vector for ${id}`);
  }

  async searchSimilar(vector: number[], limit: number = 10): Promise<Array<{ id: string; score: number; metadata?: Record<string, unknown> }>> {
    // This is a very simple implementation that doesn't actually compute similarity
    // In a real implementation, you would compute cosine similarity between vectors
    return Array.from(this.vectors.entries())
      .slice(0, limit)
      .map(([id, data]) => ({
        id,
        score: Math.random(), // Random score for demonstration
        metadata: data.metadata
      }));
  }
}

// Logger function
const logger = (logLine: LogLine) => {
  const level = logLine.level || 1;
  const prefix = "│ ".repeat(level);
  console.log(`${prefix}[${logLine.category || 'crawler'}] ${logLine.message}`);
  
  if (logLine.auxiliary) {
    for (const [key, value] of Object.entries(logLine.auxiliary)) {
      if (typeof value === 'object' && value.value !== undefined) {
        console.log(`${prefix}  ${key}: ${value.value}`);
      }
    }
  }
};

/**
 * Handles login to a SaaS application
 */
async function handleLogin(stagehand: Stagehand, loginUrl: string, email: string): Promise<boolean> {
  try {
    logger({
      category: "login",
      message: `Attempting to login at ${loginUrl} with email ${email}`,
      level: 1
    });

    // Navigate to the login page
    await stagehand.page.goto(loginUrl);
    
    // Wait for the page to load
    await stagehand.page.waitForLoadState('networkidle');
    
    // Use Stagehand's observe to find login elements
    const loginForm = await stagehand.page.observe({
      instruction: "Find the login form and identify the email input field and login/continue button"
    });
    
    logger({
      category: "login",
      message: "Login form observed",
      level: 1,
      auxiliary: {
        observation: {
          value: JSON.stringify(loginForm, null, 2),
          type: "string"
        }
      }
    });
    
    // Fill in the email field
    await stagehand.page.act(`Fill in the email field with ${email}`);
    
    // Click the login/continue button
    await stagehand.page.act("Click the submit button to proceed");
    
    // Wait for navigation or confirmation
    await stagehand.page.waitForLoadState('networkidle');
    
    // Check if login was successful
    const isLoggedIn = await stagehand.page.evaluate(() => {
      // Look for elements that typically appear after successful login
      // This is site-specific and may need adjustment
      const userMenus = document.querySelectorAll('[aria-label="User menu"], .user-menu, .avatar, .profile-icon');
      const dashboardElements = document.querySelectorAll('.dashboard, #dashboard, [data-testid="dashboard"]');
      const welcomeMessages = document.querySelectorAll('.welcome-message, .greeting');
      
      return userMenus.length > 0 || dashboardElements.length > 0 || welcomeMessages.length > 0;
    });
    
    if (isLoggedIn) {
      logger({
        category: "login",
        message: "Login successful",
        level: 1
      });
    } else {
      logger({
        category: "login",
        message: "Login may not have been successful, but continuing anyway",
        level: 1
      });
    }
    
    return isLoggedIn;
  } catch (error) {
    logger({
      category: "login",
      message: `Error during login: ${error.message}`,
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
    return false;
  }
}

async function main() {
  try {
    // Login credentials
    const loginEmail = "crmchattie@gmail.com";
    
    // Starting URL to crawl (may be different from login URL)
    const loginUrl = "https://www.testdummy.ai/login";
    const startUrl = "https://www.testdummy.ai/dashboard"; // Where to start crawling after login
    
    // Initialize OpenAI client for LLM analysis
    const openaiClient = new OpenAIClient({
      modelName: "gpt-4o",
      logger
    });
    
    // Initialize vector database
    const vectorDB = new InMemoryVectorDB();
    
    // Initialize database storage
    const storage = new ActionStorage(
      {
        host: process.env.POSTGRES_HOST || "localhost",
        port: parseInt(process.env.POSTGRES_PORT || "5432"),
        database: process.env.POSTGRES_DB || "crawler_db",
        user: process.env.POSTGRES_USER || "postgres",
        password: process.env.POSTGRES_PASSWORD || "postgres"
      },
      vectorDB,
      logger
    );
    
    // Initialize database tables
    await storage.initialize();
    logger({
      category: "runner",
      message: "Database initialized successfully",
      level: 1
    });
    
    // Launch Stagehand
    const stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 1,
      debugDom: true,
      domSettleTimeoutMs: 100,
    });
    console.log("🌟 Initializing Stagehand...");
    await stagehand.init();
    
    // Handle login first
    const loginSuccessful = await handleLogin(stagehand, loginUrl, loginEmail);
    
    if (!loginSuccessful) {
      logger({
        category: "runner",
        message: "Login may not have been successful, but continuing with crawl",
        level: 1
      });
    }
    
    // Store all actions for later comparison
    const allActions: UserAction[] = [];
    
    // Set up crawl queue and tracking
    const urlQueue: string[] = [startUrl];
    const crawledUrls = new Set<string>();
    const maxUrlsToCrawl = 10; // Limit the number of pages to crawl
    const baseUrlObj = new URL(startUrl);
    
    // Recursive crawling
    while (urlQueue.length > 0 && crawledUrls.size < maxUrlsToCrawl) {
      const url = urlQueue.shift()!;
      
      // Skip if already crawled
      if (crawledUrls.has(url)) {
        continue;
      }
      
      logger({
        category: "runner",
        message: `Starting crawl of ${url} (${crawledUrls.size + 1}/${maxUrlsToCrawl})`,
        level: 1
      });
      
      try {
        // Mark as crawled
        crawledUrls.add(url);
        
        // First, use rule-based analysis
        const { userActions: ruleBasedActions } = await crawlUrl(stagehand, url, {
          logger,
          analyzeActions: true,
          useLLM: false
        });
        
        if (ruleBasedActions && ruleBasedActions.length > 0) {
          logger({
            category: "runner",
            message: `Rule-based analysis found ${ruleBasedActions.length} actions`,
            level: 1
          });
          
          // Store rule-based actions
          await storage.storeActions(ruleBasedActions);
          allActions.push(...ruleBasedActions);
        }
        
        // Then, use LLM-based analysis if OpenAI API key is available
        if (process.env.OPENAI_API_KEY) {
          const { userActions: llmActions } = await crawlUrl(stagehand, url, {
            logger,
            analyzeActions: true,
            useLLM: true,
            llmClient: openaiClient
          });
          
          if (llmActions && llmActions.length > 0) {
            logger({
              category: "runner",
              message: `LLM-based analysis found ${llmActions.length} actions`,
              level: 1
            });
            
            // Store LLM-based actions
            await storage.storeActions(llmActions);
            allActions.push(...llmActions);
          }
        } else {
          logger({
            category: "runner",
            message: "Skipping LLM-based analysis (no OpenAI API key provided)",
            level: 1
          });
        }
        
        // Extract links from the page and add to queue
        const links = await stagehand.page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          return anchors.map(a => a.getAttribute('href')).filter(Boolean) as string[];
        });
        
        // Process and filter links
        for (const link of links) {
          try {
            // Convert relative URLs to absolute
            let absoluteUrl: string;
            try {
              absoluteUrl = new URL(link, url).href;
            } catch {
              continue; // Skip invalid URLs
            }
            
            // Only crawl URLs from the same domain
            const linkUrlObj = new URL(absoluteUrl);
            if (linkUrlObj.hostname !== baseUrlObj.hostname) {
              continue;
            }
            
            // Skip URLs with fragments or query parameters to avoid duplicates
            const cleanUrl = `${linkUrlObj.protocol}//${linkUrlObj.hostname}${linkUrlObj.pathname}`;
            
            // Skip login/logout pages to avoid session issues
            if (cleanUrl.includes('/login') || cleanUrl.includes('/logout') || 
                cleanUrl.includes('/signin') || cleanUrl.includes('/signout')) {
              continue;
            }
            
            // Skip if already crawled or in queue
            if (!crawledUrls.has(cleanUrl) && !urlQueue.includes(cleanUrl)) {
              urlQueue.push(cleanUrl);
              logger({
                category: "runner",
                message: `Added ${cleanUrl} to crawl queue`,
                level: 2
              });
            }
          } catch (error) {
            logger({
              category: "runner",
              message: `Error processing link: ${error.message}`,
              level: 2
            });
          }
        }
        
        // Add a small delay between crawls to be nice to the server
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        logger({
          category: "runner",
          message: `Error crawling ${url}: ${error.message}`,
          level: 1,
          auxiliary: {
            error: {
              value: error.message,
              type: "string"
            }
          }
        });
      }
    }
    
    // Demonstrate querying the database
    if (allActions.length > 0) {
      // Get actions by URL
      const actionsByUrl = await storage.getActionsByUrl(startUrl);
      logger({
        category: "runner",
        message: `Found ${actionsByUrl.length} actions for URL ${startUrl}`,
        level: 1
      });
      
      // Get actions by type (if any login actions were found)
      const loginActions = await storage.getActionsByType("login");
      logger({
        category: "runner",
        message: `Found ${loginActions.length} login actions`,
        level: 1
      });
      
      // Demonstrate similarity search
      const similarActions = await storage.findSimilarActions("login form");
      logger({
        category: "runner",
        message: `Found ${similarActions.length} actions similar to "login form"`,
        level: 1
      });
    }
    
    // Summary
    logger({
      category: "runner",
      message: `Crawl completed: ${crawledUrls.size} pages crawled, ${allActions.length} actions identified`,
      level: 1
    });
    
    // Close browser and database connections
    await stagehand.close();
    await storage.close();
    
    logger({
      category: "runner",
      message: "Crawler run completed successfully",
      level: 1
    });
  } catch (error) {
    console.error("Error running crawler:", error);
  }
}

// Run the main function
main().catch(console.error); 