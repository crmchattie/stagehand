import { CrawlResult, ElementInfo } from "./PageCrawler";
import { LogLine } from "../../types/log";
import { LLMClient } from "../llm/LLMClient";
import { z } from "zod";
import { v4 as uuidv4 } from 'uuid';

export interface UserAction {
  type: string;
  name: string;
  description: string;
  elements: ElementInfo[];
  url: string;
  confidence: number; // 0-1 score indicating confidence in this action identification
}

export class LLMActionAnalyzer {
  private logger: (logLine: LogLine) => void;
  private llmClient: LLMClient;

  constructor(llmClient: LLMClient, logger: (logLine: LogLine) => void) {
    this.llmClient = llmClient;
    this.logger = logger;
  }

  /**
   * Analyzes crawl results using an LLM to identify potential user actions
   */
  public async analyzeActions(crawlResult: CrawlResult): Promise<UserAction[]> {
    this.logger({
      category: "llm-action-analyzer",
      message: `Analyzing ${crawlResult.elements.length} elements for user actions using LLM`,
      level: 1,
    });

    // Prepare the elements data for the LLM
    const elementsData = this.prepareElementsData(crawlResult.elements);
    
    // Define the schema for the LLM response
    const actionSchema = z.object({
      actions: z.array(z.object({
        type: z.string().describe("The type of action (e.g., login, search, navigation, form, etc.)"),
        name: z.string().describe("A short, descriptive name for the action"),
        description: z.string().describe("A detailed description of what this action does"),
        elementIndices: z.array(z.number()).describe("Indices of elements that make up this action"),
        confidence: z.number().min(0).max(1).describe("Confidence score (0-1) for this action identification")
      }))
    });

    try {
      // Call the LLM to analyze the elements
      const response = await this.llmClient.createChatCompletion<z.infer<typeof actionSchema>>({
        options: {
          messages: [
            {
              role: "system",
              content: this.getSystemPrompt()
            },
            {
              role: "user",
              content: this.getUserPrompt(crawlResult.url, elementsData)
            }
          ],
          temperature: 0.2,
          response_model: {
            name: "ActionAnalysis",
            schema: actionSchema
          },
          requestId: uuidv4()
        },
        logger: this.logger
      });

      // Map the LLM response to UserAction objects
      const userActions = response.actions.map(action => {
        const actionElements = action.elementIndices
          .map(index => crawlResult.elements[index])
          .filter(Boolean); // Filter out any undefined elements

        return {
          type: action.type,
          name: action.name,
          description: action.description,
          elements: actionElements,
          url: crawlResult.url,
          confidence: action.confidence
        };
      });

      this.logger({
        category: "llm-action-analyzer",
        message: `LLM identified ${userActions.length} potential user actions`,
        level: 1,
      });

      return userActions;
    } catch (error) {
      this.logger({
        category: "llm-action-analyzer",
        message: "Error analyzing actions with LLM",
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
      
      // Return empty array on error
      return [];
    }
  }

  /**
   * Prepares the elements data in a format suitable for the LLM
   */
  private prepareElementsData(elements: ElementInfo[]): string {
    return elements.map((element, index) => {
      // Format attributes as a string
      const attributesStr = Object.entries(element.attributes || {})
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');

      return `[${index}] ${element.type} ${attributesStr} - "${element.text}" - ${element.description}`;
    }).join('\n');
  }

  /**
   * Gets the system prompt for the LLM
   */
  private getSystemPrompt(): string {
    return `
You are an expert web analyst that can identify user actions on a webpage based on HTML elements.
Your task is to analyze a list of elements from a webpage and identify potential user actions such as:

1. Login forms
2. Registration forms
3. Search interfaces
4. Navigation menus
5. Contact forms
6. Checkout processes
7. Product filtering/sorting
8. Any other interactive user actions

For each action, determine:
- The type of action
- A descriptive name
- A detailed description of what the action does
- Which elements are part of this action (by their indices)
- A confidence score (0-1) indicating how confident you are in this identification

Group related elements that work together to form a single user action.
Focus on identifying complete, functional actions that users can perform.
`;
  }

  /**
   * Gets the user prompt for the LLM with the page data
   */
  private getUserPrompt(url: string, elementsData: string): string {
    return `
I need you to analyze the following webpage elements from ${url} and identify all possible user actions.

Here are the elements on the page:
${elementsData}

Based on these elements, identify all user actions on this page. For each action:
1. Determine what type of action it is (login, search, navigation, etc.)
2. Give it a descriptive name
3. Provide a detailed description of what the action does
4. List the indices of elements that make up this action
5. Assign a confidence score (0-1)

Focus on identifying complete, functional actions that users can perform.
`;
  }
} 