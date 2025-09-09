// reNorsk Extension - Service Worker for Manifest V3
// Corrects Norwegian text on active website where synthetically constructed debasements or knockoffs (often varians of radical nynorsk) has been applied.

console.log('reNorsk: Service worker starting up...');

// Track processed URLs to avoid redundant API calls
const processedUrls = new Map();
const CACHE_DURATION = 3000; // 5 minutes in milliseconds

// Clean up old entries from the cache
function cleanupCache() {
  const now = Date.now();
  for (const [url, timestamp] of processedUrls.entries()) {
    if (now - timestamp > CACHE_DURATION) {
      processedUrls.delete(url);
    }
  }
}

// Check if URL was recently processed
function wasRecentlyProcessed(url) {
  cleanupCache();
  const lastProcessed = processedUrls.get(url);
  return lastProcessed && (Date.now() - lastProcessed) < CACHE_DURATION;
}

// Mark URL as processed
function markAsProcessed(url) {
  processedUrls.set(url, Date.now());
}

// Language detection function using Apertium identifyLang API
async function detectLanguage(text) {
  try {
    const url = 'https://www.apertium.org/apy/identifyLang';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ q: text }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('reNorsk: Error detecting language:', error);
    return null;
  }
}

// Check if page should be automatically translated
async function checkAndAutoTranslate(tabId) {
  try {
    // Get tab info to check URL
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) {
      return;
    }
    
    // Skip if this URL was recently processed
    if (wasRecentlyProcessed(tab.url)) {
      console.log('reNorsk: URL recently processed, skipping:', tab.url);
      return;
    }
    
    // Extract text from the page for language detection
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageText
    });
    
    if (!results || !results[0] || !results[0].result) {
      console.log('reNorsk: No text extracted for language detection');
      return;
    }
    
    const pageText = results[0].result;
    if (pageText.length < 50) {
      console.log('reNorsk: Not enough text for reliable language detection');
      return;
    }
    
    // Detect language
    const languageScores = await detectLanguage(pageText);
    if (!languageScores) {
      console.log('reNorsk: Language detection failed');
      return;
    }
    
    // Check if Norwegian Nynorsk (nno) is detected with high confidence
    const nnoScore = languageScores.nno || -1;
    const CONFIDENCE_THRESHOLD = 0.5; // Adjust this threshold as needed
    const bestLanguage = Object.entries(languageScores).sort((a, b) => b[1] - a[1])[0];
    const bestLanguageScore = bestLanguage[1];
    console.log('reNorsk: Best language:', bestLanguage[0]);
    console.log('reNorsk: Best language score:', bestLanguageScore);
    console.log('reNorsk: Language detection scores:', languageScores);
    console.log('reNorsk: Nynorsk (nno) confidence:', nnoScore);
    
    // Mark URL as processed regardless of outcome to avoid repeated checks
    markAsProcessed(tab.url);
    
    if (bestLanguage[0] === "nno" && nnoScore > CONFIDENCE_THRESHOLD) {
      console.log('reNorsk: Norwegian Nynorsk detected with high confidence, triggering automatic translation');
      
      // Show notification about automatic translation
      if (chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'src/images/icon48.png',
          title: 'reNorsk',
          message: 'Nynorsk oppdaget! Oversetter automatisk til bokmål...'
        });
      }
      
      // Execute translation
      await chrome.scripting.executeScript({
        target: { tabId },
        func: pageScript
      });
    } else {
      console.log('reNorsk: Norwegian Nynorsk not detected with sufficient confidence');
    }
  } catch (error) {
    console.error('reNorsk: Error in automatic language detection:', error);
  }
}

// Function to extract text from page for language detection
function extractPageText() {
  // Get visible text from the page, focusing on main content
  const textNodes = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        // Skip script, style, and input elements
        const tagName = parent.tagName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT'].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Skip if parent is hidden
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Only process nodes with meaningful text
        const text = node.nodeValue.trim();
        if (text.length > 10 && /[a-zA-ZæøåÆØÅ]/.test(text)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        
        return NodeFilter.FILTER_REJECT;
      }
    }
  );
  
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node.nodeValue.trim());
  }
  
  // Return first 1000 characters of combined text for language detection
  const combinedText = textNodes.join(' ').substring(0, 2000);
  return combinedText;
}

// Correction of the active tab
async function executeCorrection() {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (tab) {
      await chrome.scripting.executeScript({
        target: {tabId: tab.id},
        func: pageScript
      });
      console.log('reNorsk: Language correction executed successfully on', tab.url);
    }
  } catch (error) {
    console.error('reNorsk: Error executing correction:', error);
    
    // Show error notification if possible
    if (chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'src/images/icon48.png',
        title: 'reNorsk',
        message: 'Rettingen ble ikke gjennomført :( Det er mulig siden du er på ikke er støttet.'
      });
    }
  }
}

// Keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "correct_page") {
    console.log('reNorsk: Keyboard shortcut triggered');
    await executeCorrection();
  }
});

// Extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  console.log('reNorsk: Extension icon clicked');
  await executeCorrection();
});

// Listen for tab updates (page loads) to trigger automatic language detection
console.log('reNorsk: Registering tab update listener...');
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  console.log('reNorsk: Tab updated - tabId:', tabId, 'status:', changeInfo.status, 'url:', tab.url);
  
  // Only trigger on complete page loads
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    console.log('reNorsk: Page loaded, checking for automatic translation:', tab.url);
    
    // Add a small delay to ensure page content is fully loaded
    setTimeout(() => {
      checkAndAutoTranslate(tabId);
    }, 1000);
  }
});

// Listen for tab activation (switching to a tab) to potentially trigger detection
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
      console.log('reNorsk: Tab activated, checking for automatic translation:', tab.url);
      
      // Only check if we haven't recently checked this tab
      setTimeout(() => {
        checkAndAutoTranslate(activeInfo.tabId);
      }, 500);
    }
  } catch (error) {
    console.error('reNorsk: Error handling tab activation:', error);
  }
});

// Content script function (injected into the webpage)
function pageScript() {
    console.log('reNorsk: Correction script started');
    
    // Configuration
    const MAX_CONCURRENT = 20; // Maximum concurrent API calls to prevent overwhelming the API
    
    // Store reference to indicator element
    let indicatorElement = null;
    let totalNodes = 0;
    let processedNodes = 0;
    
    // Progress indicator (visual)
    function showCorrectionIndicator(total) {
        totalNodes = total;
        processedNodes = 0;
        
        // Remove any existing indicator
        const existing = document.getElementById('reNorsk-indicator');
        if (existing) existing.remove();
        
        indicatorElement = document.createElement('div');
        indicatorElement.id = 'reNorsk-indicator';
        indicatorElement.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="reNorsk-spinner">🇳🇴</span>
                <span class="reNorsk-text">reNorsk retter...</span>
                <span class="reNorsk-progress">0/${totalNodes}</span>
            </div>
        `;
        indicatorElement.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: #8BBCD2;
            color: white;
            padding: 10px 15px;
            border-radius: 6px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        
        // Spinner (animation)
        const existingStyle = document.getElementById('reNorsk-style');
        if (!existingStyle) {
            const style = document.createElement('style');
            style.id = 'reNorsk-style';
            style.textContent = `
                @keyframes reNorsk-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                #reNorsk-indicator .reNorsk-spinner {
                    display: inline-block;
                    animation: reNorsk-spin 1s linear infinite;
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(indicatorElement);
    }
    
    // Progress update
    function updateProgress() {
        processedNodes++;
        if (indicatorElement) {
            const progressElement = indicatorElement.querySelector('.reNorsk-progress');
            if (progressElement) {
                progressElement.textContent = `${processedNodes}/${totalNodes}`;
            }
            
            // Check if complete
            if (processedNodes >= totalNodes) {
                setTimeout(() => {
                    if (indicatorElement) {
                        indicatorElement.querySelector('.reNorsk-text').textContent = 'Retting fullført! 🎉';
                        indicatorElement.querySelector('.reNorsk-spinner').textContent = '🎉';
                        indicatorElement.style.background = '#B5DAC0';
                        
                        setTimeout(() => {
                            if (indicatorElement && indicatorElement.parentNode) {
                                indicatorElement.style.opacity = '0';
                                setTimeout(() => {
                                    if (indicatorElement && indicatorElement.parentNode) {
                                        indicatorElement.parentNode.removeChild(indicatorElement);
                                    }
                                }, 300);
                            }
                        }, 1500);
                    }
                }, 100);
            }
        }
    }
    
    // Correction (Translation) function
    async function correctText(textNode) {
        try {
            const originalText = textNode.nodeValue;
            const text = originalText.trim();
            
            // Skip very short or non-text content
            if (text.length < 2 || text.length > 500 || !/[a-zA-ZæøåÆØÅ]/.test(text)) {
                return;
            }
            
            const url = `https://www.apertium.org/apy/translate?q=${encodeURIComponent(text)}&langpair=nno|nob`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data && data.responseData && data.responseData.translatedText) {
                const translatedText = data.responseData.translatedText.replace(/\*/g, '');
                if (translatedText !== text) {
                    // Preserve original whitespace (spaces, tabs, newlines) at the beginning and end
                    const leadingWhitespace = originalText.match(/^\s*/)[0];
                    const trailingWhitespace = originalText.match(/\s*$/)[0];
                    textNode.nodeValue = leadingWhitespace + translatedText + trailingWhitespace;
                    console.log(`reNorsk: Rettet "${text.substring(0, 30)}..."`);
                }
            }
        } catch (error) {
            console.error('reNorsk: Error :(', error);
        } finally {
            updateProgress();
        }
    }
    
    // Process segments of text nodes
    async function processChunk(nodes) {
        const promises = nodes.map(node => correctText(node));
        await Promise.allSettled(promises);
    }
    
    // Get all text nodes
    function getAllTextNodes() {
        const textNodes = [];
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    
                    // Skip script, style, and input elements
                    const tagName = parent.tagName;
                    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT'].includes(tagName)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    // Skip if parent is contenteditable
                    if (parent.contentEditable === 'true') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    // Skip if parent is hidden
                    const style = getComputedStyle(parent);
                    if (style.display === 'none' || style.visibility === 'hidden') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    // Only process nodes with meaningful text
                    const text = node.nodeValue.trim();
                    if (text.length > 2 && /[a-zA-ZæøåÆØÅ]/.test(text)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    
                    return NodeFilter.FILTER_REJECT;
                }
            }
        );
        
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }
        
        return textNodes;
    }
    
    // Main Correction function
    async function correctPage() {
        console.log('reNorsk: Starting language corrections');
        
        // Get all text nodes
        const textNodes = getAllTextNodes();
        totalNodes = textNodes.length;
        
        console.log(`reNorsk: Fant ${totalNodes} tekstnoder`);
        
        if (totalNodes === 0) {
            console.log('reNorsk: No text nodes found to correct');
            return;
        }
        
        // Show indicator
        showCorrectionIndicator(totalNodes);
        
        // Segment workload to prevent resource saturation
        for (let i = 0; i < textNodes.length; i += MAX_CONCURRENT) {
            const chunk = textNodes.slice(i, i + MAX_CONCURRENT);
            await processChunk(chunk);
            
            // Throttling to respect API rate limits
            if (i + MAX_CONCURRENT < textNodes.length) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        console.log('reNorsk: Retting fullført!');
    }
    
    // Start correction immediately
    correctPage();
}