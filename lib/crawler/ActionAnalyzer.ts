import { CrawlResult, ElementInfo } from "./PageCrawler";
import { LogLine } from "../../types/log";

export interface UserAction {
  type: string;
  name: string;
  description: string;
  elements: ElementInfo[];
  url: string;
  confidence: number; // 0-1 score indicating confidence in this action identification
}

export class ActionAnalyzer {
  private logger: (logLine: LogLine) => void;

  constructor(logger: (logLine: LogLine) => void) {
    this.logger = logger;
  }

  /**
   * Analyzes crawl results to identify potential user actions
   */
  public analyzeActions(crawlResult: CrawlResult): UserAction[] {
    this.logger({
      category: "action-analyzer",
      message: `Analyzing ${crawlResult.elements.length} elements for user actions`,
      level: 1,
    });

    const actions: UserAction[] = [];

    // Identify login forms
    const loginActions = this.identifyLoginForms(crawlResult);
    actions.push(...loginActions);

    // Identify search interfaces
    const searchActions = this.identifySearchInterfaces(crawlResult);
    actions.push(...searchActions);

    // Identify navigation menus
    const navigationActions = this.identifyNavigationMenus(crawlResult);
    actions.push(...navigationActions);

    // Identify forms (registration, contact, etc.)
    const formActions = this.identifyForms(crawlResult);
    actions.push(...formActions);

    this.logger({
      category: "action-analyzer",
      message: `Identified ${actions.length} potential user actions`,
      level: 1,
    });

    return actions;
  }

  /**
   * Identifies login forms based on input fields and submit buttons
   */
  private identifyLoginForms(crawlResult: CrawlResult): UserAction[] {
    const actions: UserAction[] = [];
    const { elements, url } = crawlResult;

    // Find potential username/email inputs
    const usernameInputs = elements.filter(el => 
      el.type === "input" && 
      (
        el.attributes.type === "text" || 
        el.attributes.type === "email"
      ) && 
      (
        el.attributes.name?.toLowerCase().includes("user") ||
        el.attributes.name?.toLowerCase().includes("email") ||
        el.attributes.name?.toLowerCase().includes("login") ||
        el.attributes.id?.toLowerCase().includes("user") ||
        el.attributes.id?.toLowerCase().includes("email") ||
        el.attributes.id?.toLowerCase().includes("login") ||
        el.attributes.placeholder?.toLowerCase().includes("user") ||
        el.attributes.placeholder?.toLowerCase().includes("email") ||
        el.description.toLowerCase().includes("username") ||
        el.description.toLowerCase().includes("email")
      )
    );

    // Find potential password inputs
    const passwordInputs = elements.filter(el => 
      el.type === "input" && 
      (
        el.attributes.type === "password" ||
        el.attributes.name?.toLowerCase().includes("pass") ||
        el.attributes.id?.toLowerCase().includes("pass") ||
        el.attributes.placeholder?.toLowerCase().includes("pass") ||
        el.description.toLowerCase().includes("password")
      )
    );

    // Find potential submit buttons
    const submitButtons = elements.filter(el => 
      (el.type === "button" || el.type === "input") && 
      (
        el.attributes.type === "submit" ||
        el.text.toLowerCase().includes("log in") ||
        el.text.toLowerCase().includes("login") ||
        el.text.toLowerCase().includes("sign in") ||
        el.text.toLowerCase().includes("signin") ||
        el.description.toLowerCase().includes("login") ||
        el.description.toLowerCase().includes("sign in")
      )
    );

    // Group elements that are likely part of the same form
    if (usernameInputs.length > 0 && passwordInputs.length > 0) {
      // For each username input, find the closest password input and submit button
      for (const usernameInput of usernameInputs) {
        const nearbyPasswordInputs = this.findNearbyElements(usernameInput, passwordInputs);
        
        if (nearbyPasswordInputs.length > 0) {
          const nearbySubmitButtons = this.findNearbyElements(nearbyPasswordInputs[0], submitButtons);
          
          if (nearbySubmitButtons.length > 0) {
            // We have a username, password, and submit button - likely a login form
            const loginElements = [
              usernameInput,
              nearbyPasswordInputs[0],
              nearbySubmitButtons[0]
            ];
            
            actions.push({
              type: "login",
              name: "Login",
              description: "Login form with username/email and password fields",
              elements: loginElements,
              url,
              confidence: 0.9 // High confidence if we have all three elements
            });
          } else {
            // We have username and password but no submit - still likely a login form
            actions.push({
              type: "login",
              name: "Login",
              description: "Partial login form with username/email and password fields",
              elements: [usernameInput, nearbyPasswordInputs[0]],
              url,
              confidence: 0.7 // Medium confidence without submit button
            });
          }
        }
      }
    }

    return actions;
  }

  /**
   * Identifies search interfaces based on input fields and search buttons
   */
  private identifySearchInterfaces(crawlResult: CrawlResult): UserAction[] {
    const actions: UserAction[] = [];
    const { elements, url } = crawlResult;

    // Find potential search inputs
    const searchInputs = elements.filter(el => 
      el.type === "input" && 
      (
        el.attributes.type === "search" ||
        el.attributes.name?.toLowerCase().includes("search") ||
        el.attributes.id?.toLowerCase().includes("search") ||
        el.attributes.placeholder?.toLowerCase().includes("search") ||
        el.description.toLowerCase().includes("search")
      )
    );

    // Find potential search buttons
    const searchButtons = elements.filter(el => 
      (el.type === "button" || el.type === "input") && 
      (
        el.attributes.type === "submit" ||
        el.text.toLowerCase().includes("search") ||
        el.description.toLowerCase().includes("search") ||
        // Often search buttons have magnifying glass icons
        el.attributes.class?.toLowerCase().includes("search")
      )
    );

    // Group elements that are likely part of the same search interface
    for (const searchInput of searchInputs) {
      const nearbySearchButtons = this.findNearbyElements(searchInput, searchButtons);
      
      if (nearbySearchButtons.length > 0) {
        // We have a search input and button - likely a search interface
        actions.push({
          type: "search",
          name: "Search",
          description: "Search interface with input field and search button",
          elements: [searchInput, nearbySearchButtons[0]],
          url,
          confidence: 0.9 // High confidence with both elements
        });
      } else {
        // Just a search input - still likely a search interface
        actions.push({
          type: "search",
          name: "Search",
          description: "Search input field",
          elements: [searchInput],
          url,
          confidence: 0.7 // Medium confidence with just input
        });
      }
    }

    return actions;
  }

  /**
   * Identifies navigation menus based on groups of links
   */
  private identifyNavigationMenus(crawlResult: CrawlResult): UserAction[] {
    const actions: UserAction[] = [];
    const { elements, url } = crawlResult;

    // Find potential navigation elements
    const navElements = elements.filter(el => 
      el.type === "nav" || 
      el.attributes.role === "navigation" ||
      el.attributes.class?.toLowerCase().includes("nav") ||
      el.attributes.id?.toLowerCase().includes("nav") ||
      el.attributes.class?.toLowerCase().includes("menu") ||
      el.attributes.id?.toLowerCase().includes("menu")
    );

    // Find all links
    const links = elements.filter(el => el.type === "a" && el.attributes.href);

    // For each potential navigation container, find links that might be inside it
    for (const navElement of navElements) {
      const navLinks = links.filter(link => 
        // Check if link is likely inside the nav element based on position
        link.position.y >= navElement.position.y &&
        link.position.y <= (navElement.position.y + 100) && // Approximate height
        link.position.x >= navElement.position.x &&
        link.position.x <= (navElement.position.x + 1000) // Approximate width
      );

      if (navLinks.length >= 3) { // At least 3 links to consider it a navigation menu
        actions.push({
          type: "navigation",
          name: "Navigation Menu",
          description: `Navigation menu with ${navLinks.length} links`,
          elements: [navElement, ...navLinks],
          url,
          confidence: 0.8
        });
      }
    }

    // If no navigation containers were found, look for groups of links
    if (actions.length === 0) {
      // Group links by their vertical position (within 20px)
      const linkGroups: ElementInfo[][] = [];
      
      for (const link of links) {
        let added = false;
        for (const group of linkGroups) {
          const firstLink = group[0];
          if (Math.abs(link.position.y - firstLink.position.y) < 20) {
            group.push(link);
            added = true;
            break;
          }
        }
        
        if (!added) {
          linkGroups.push([link]);
        }
      }
      
      // Consider groups with at least 3 links as potential navigation menus
      for (const group of linkGroups) {
        if (group.length >= 3) {
          actions.push({
            type: "navigation",
            name: "Navigation Menu",
            description: `Horizontal navigation menu with ${group.length} links`,
            elements: group,
            url,
            confidence: 0.7
          });
        }
      }
    }

    return actions;
  }

  /**
   * Identifies forms like registration, contact, etc.
   */
  private identifyForms(crawlResult: CrawlResult): UserAction[] {
    const actions: UserAction[] = [];
    const { elements, url } = crawlResult;

    // Find form elements
    const formElements = elements.filter(el => el.type === "form");
    
    // Find all input elements
    const inputElements = elements.filter(el => 
      el.type === "input" || 
      el.type === "textarea" || 
      el.type === "select"
    );
    
    // Find submit buttons
    const submitButtons = elements.filter(el => 
      (el.type === "button" || el.type === "input") && 
      (
        el.attributes.type === "submit" ||
        el.text.toLowerCase().includes("submit") ||
        el.text.toLowerCase().includes("send") ||
        el.text.toLowerCase().includes("register") ||
        el.text.toLowerCase().includes("sign up")
      )
    );

    // For each form element, find inputs that might be inside it
    for (const formElement of formElements) {
      const formInputs = inputElements.filter(input => 
        // Check if input is likely inside the form element based on position
        input.position.y >= formElement.position.y &&
        input.position.y <= (formElement.position.y + 500) && // Approximate height
        input.position.x >= formElement.position.x &&
        input.position.x <= (formElement.position.x + 1000) // Approximate width
      );
      
      const formSubmitButtons = submitButtons.filter(button => 
        // Check if button is likely inside the form element based on position
        button.position.y >= formElement.position.y &&
        button.position.y <= (formElement.position.y + 500) && // Approximate height
        button.position.x >= formElement.position.x &&
        button.position.x <= (formElement.position.x + 1000) // Approximate width
      );
      
      if (formInputs.length >= 2 && formSubmitButtons.length > 0) {
        // Determine form type based on input fields
        let formType = "form";
        let formName = "Form";
        let confidence = 0.7;
        
        // Check for registration form
        const hasNameField = formInputs.some(input => 
          input.attributes.name?.toLowerCase().includes("name") ||
          input.attributes.id?.toLowerCase().includes("name") ||
          input.attributes.placeholder?.toLowerCase().includes("name")
        );
        
        const hasEmailField = formInputs.some(input => 
          input.attributes.type === "email" ||
          input.attributes.name?.toLowerCase().includes("email") ||
          input.attributes.id?.toLowerCase().includes("email") ||
          input.attributes.placeholder?.toLowerCase().includes("email")
        );
        
        const hasPasswordField = formInputs.some(input => 
          input.attributes.type === "password" ||
          input.attributes.name?.toLowerCase().includes("password") ||
          input.attributes.id?.toLowerCase().includes("password") ||
          input.attributes.placeholder?.toLowerCase().includes("password")
        );
        
        // Check for contact form
        const hasMessageField = formInputs.some(input => 
          input.type === "textarea" ||
          input.attributes.name?.toLowerCase().includes("message") ||
          input.attributes.id?.toLowerCase().includes("message") ||
          input.attributes.placeholder?.toLowerCase().includes("message")
        );
        
        const hasSubjectField = formInputs.some(input => 
          input.attributes.name?.toLowerCase().includes("subject") ||
          input.attributes.id?.toLowerCase().includes("subject") ||
          input.attributes.placeholder?.toLowerCase().includes("subject")
        );
        
        // Determine form type
        if (hasNameField && hasEmailField && hasPasswordField) {
          formType = "registration";
          formName = "Registration Form";
          confidence = 0.9;
        } else if (hasNameField && hasEmailField && hasMessageField) {
          formType = "contact";
          formName = "Contact Form";
          confidence = 0.9;
        } else if (hasEmailField && hasSubjectField && hasMessageField) {
          formType = "contact";
          formName = "Contact Form";
          confidence = 0.9;
        }
        
        actions.push({
          type: formType,
          name: formName,
          description: `${formName} with ${formInputs.length} input fields`,
          elements: [formElement, ...formInputs, ...formSubmitButtons],
          url,
          confidence
        });
      }
    }

    return actions;
  }

  /**
   * Finds elements that are nearby (spatially) to a reference element
   */
  private findNearbyElements(reference: ElementInfo, candidates: ElementInfo[]): ElementInfo[] {
    // Sort candidates by distance to reference element
    return [...candidates].sort((a, b) => {
      const distA = this.calculateDistance(reference.position, a.position);
      const distB = this.calculateDistance(reference.position, b.position);
      return distA - distB;
    });
  }

  /**
   * Calculates Euclidean distance between two points
   */
  private calculateDistance(p1: {x: number, y: number}, p2: {x: number, y: number}): number {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }
} 