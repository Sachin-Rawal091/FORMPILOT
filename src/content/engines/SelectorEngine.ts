import { SelectorMeta, SelectorResult, SelectorStrategy } from "../../types";
import { SHADOW_TRAVERSAL_LIMIT } from "../../shared/constants";

/**
 * 8-layer fallback Selector Engine
 */
export class SelectorEngine {
  /**
   * Tries to find an element using the 8-layer fallback strategy.
   * Returns the first match that exceeds the confidence threshold, or null if none found.
   */
  static findElement(meta: SelectorMeta, selector: string): SelectorResult | null {

    // 1. ID (1.0 confidence)
    if (meta.id) {
      const el = document.getElementById(meta.id);
      if (el) return { element: el, strategy: SelectorStrategy.ID, confidence: 1.0, shadow: false };
    }

    // If a raw selector is provided, try that as well with high confidence (e.g. primary captured selector)
    if (selector) {
      try {
        const el = document.querySelector(selector);
        if (el) return { element: el, strategy: SelectorStrategy.CSS_PATH, confidence: 0.95, shadow: false };
      } catch (e) {
        // ignore invalid selector
      }
    }

    // 2. Name (0.9 confidence)
    if (meta.name) {
      const el = document.querySelector(`[name="${CSS.escape(meta.name)}"]`);
      if (el) return { element: el, strategy: SelectorStrategy.NAME, confidence: 0.9, shadow: false };
    }

    // 3. Aria-label (0.85 confidence)
    if (meta.ariaLabel) {
      const el = document.querySelector(`[aria-label="${CSS.escape(meta.ariaLabel)}"]`);
      if (el) return { element: el, strategy: SelectorStrategy.ARIA_LABEL, confidence: 0.85, shadow: false };
    }

    // 4. Label-linked (0.8 confidence)
    // Try label linked by text if available
    if (meta.labelText) {
      const labels = Array.from(document.querySelectorAll("label"));
      const matchingLabel = labels.find((l) => l.textContent?.trim() === meta.labelText);
      if (matchingLabel) {
        const targetId = matchingLabel.getAttribute("for");
        if (targetId) {
          const el = document.getElementById(targetId);
          if (el) return { element: el, strategy: SelectorStrategy.LABEL_LINKED, confidence: 0.8, shadow: false };
        }
        // or check if input is nested inside label
        const nestedInput = matchingLabel.querySelector("input, select, textarea");
        if (nestedInput) {
          return { element: nestedInput, strategy: SelectorStrategy.LABEL_LINKED, confidence: 0.8, shadow: false };
        }
      }
    }

    // 5. Placeholder (0.7 confidence)
    if (meta.placeholder) {
      const el = document.querySelector(`[placeholder="${CSS.escape(meta.placeholder)}"]`);
      if (el) return { element: el, strategy: SelectorStrategy.PLACEHOLDER, confidence: 0.7, shadow: false };
    }

    // 6. CSS Path (0.5 confidence)
    if (meta.cssPath) {
      try {
        const el = document.querySelector(meta.cssPath);
        if (el) return { element: el, strategy: SelectorStrategy.CSS_PATH, confidence: 0.5, shadow: false };
      } catch (e) {
        // ignore invalid selector
      }
    }

    // 7. XPath (0.4 confidence)
    if (meta.xpath) {
      try {
        const result = document.evaluate(
          meta.xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        if (result.singleNodeValue) {
          return {
            element: result.singleNodeValue as Element,
            strategy: SelectorStrategy.XPATH,
            confidence: 0.4,
            shadow: false,
          };
        }
      } catch (e) {
        // ignore invalid xpath
      }
    }

    // 8. Shadow DOM (0.6 confidence)
    // We search across all shadow roots recursively, up to SHADOW_TRAVERSAL_LIMIT
    const shadowMatch = this.findInShadowDOM(meta, selector);
    if (shadowMatch) {
      return shadowMatch;
    }

    return null;
  }

  private static findInShadowDOM(
    meta: SelectorMeta,
    primarySelector: string
  ): SelectorResult | null {
    let elementsChecked = 0;
    let foundElement: Element | null = null;

    const traverse = (root: Document | ShadowRoot) => {
      if (elementsChecked >= SHADOW_TRAVERSAL_LIMIT || foundElement) return;

      const allElements = root.querySelectorAll("*");
      for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        elementsChecked++;

        if (elementsChecked >= SHADOW_TRAVERSAL_LIMIT) break;

        // Try primary selector
        if (primarySelector) {
          try {
            if (el.matches && el.matches(primarySelector)) {
              foundElement = el;
              return;
            }
          } catch (e) {}
        }

        // Try ID
        if (meta.id && el.id === meta.id) {
          foundElement = el;
          return;
        }

        // Try Name
        if (meta.name && el.getAttribute("name") === meta.name) {
          foundElement = el;
          return;
        }

        // If it has a shadow root, traverse it
        if (el.shadowRoot) {
          traverse(el.shadowRoot);
        }
      }
    };

    traverse(document);

    if (foundElement) {
      return {
        element: foundElement,
        strategy: SelectorStrategy.SHADOW_DOM,
        confidence: 0.6,
        shadow: true,
      };
    }

    return null;
  }
}
