'use strict';

// Setup communication with script.js so we can access js objects of the page.
const s = document.createElement('script');
s.src = chrome.runtime.getURL('src/script.js');
document.head.appendChild(s);
s.onload = function () {
  s.remove();
};

// the last textvalue emitted
let lastText = undefined;
// the last textvalue emitted that has been filtered
let lastFilteredText = undefined;

let userFilters = [];

// Diff_match_patch object
let dmp = new diff_match_patch();

// whether the plugin is active
let active = false;

// whether scroll between overleaf and textarea should be synced
let syncScroll = false;

//Fallback method for merging changes back to the editor
let justDidFallback = false;
const isFireFox = typeof InstallTrigger !== 'undefined';

// Determines whether it is the first time and should focuss on the textarea
let firstTimeFocus = true;


// checks the first time whether the plugin is active
chrome.storage.sync.get(['active'], function (result) {
  active = result.active === undefined ? true : result.active;
  if (active) {
    createPluginElement();
  }
});

// event listener for when the app becomes (in)active
chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (changes['active']) {
    active = changes['active'].newValue;
    if (active) {
      createPluginElement();
    } else {
      removeSpellCheckElement();
    }
  }
});

// checks the first time
chrome.storage.sync.get(['syncScroll'], function (result) {
  syncScroll = result.syncScroll === undefined ? true : result.syncScroll;
});
chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (changes['syncScroll']) {
    syncScroll = changes['syncScroll'].newValue;
  }
});


// checks the first time
chrome.storage.sync.get(['customRegex'], function (result) {
  userFilters = result.customRegex || [];
});

// event listener for the user filters
chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (changes['customRegex']) {
    userFilters = changes['customRegex'].newValue;
  }
});

// Receive events from script.js
document.addEventListener('return_command', function (e) {

  const message = JSON.parse(e.detail);

  // Currently the only value we are expecting is the editor value
  if (message.method === 'getValue') {

    // This is used as a fallbackmethod for FireFox. The input event is not triggerd by Grammarly.
    if (
      isFireFox &&
      lastFilteredText !== undefined &&
      !justDidFallback &&
      JSON.stringify({a: lastFilteredText}) !== JSON.stringify({a: getSpellCheckTextElement().value})
    ) {
      inputChangeEvent()
      justDidFallback = true;
    } else {
      justDidFallback = false;


      let spellcheckContainer = getPluginElement();
      if (spellcheckContainer !== null) {
        const text = message.value;

        const filteredText = filter(text);

        // Setting the last texts to we can access them later.
        lastText = text;
        lastFilteredText = filteredText;


        // Update the textarea if present and text has changed.
        const spellcheck = getSpellCheckTextElement()
        if (spellcheck !== null) {
          const current = document.activeElement;
          if (spellcheck.value !== filteredText) {
            const scrollTop = spellcheck.scrollTop;
            spellcheck.value = filteredText;

            if (firstTimeFocus) {
              spellcheck.focus();
              current.focus();
              firstTimeFocus = false;
            }
            spellcheck.scrollTop = scrollTop;
          }
        }
      }
    }
  }

});

let aside = document.querySelector('aside.editor-sidebar');
aside.addEventListener("click", () => {
  if (active) {
    chrome.storage.sync.set({active: false}, function () {
    });
    setTimeout(() => {
      chrome.storage.sync.set({active: true}, function () {
      });
    }, 1000);
  }
});

// get the textvalue every two seconds
setInterval(() => {
  const message = JSON.stringify({method: 'getValue', args: []});

  document.dispatchEvent(new CustomEvent('call_command', {detail: message}));
}, 2000);

// Sync overleaf scroll
document.addEventListener('overleaf_scroll', function (e) {
  const percentage = e.detail;
  const textarea = getSpellCheckTextElement();
  if (textarea && syncScroll) {
    textarea.scrollTop = textarea.scrollHeight * (percentage / 100);
  }
});

//Send textarea scroll
setTimeout(() => {
  const textarea = getSpellCheckTextElement();
  if (textarea) {
    // Sync scroll from overleaf
    textarea.addEventListener('scroll', function () {
      if(syncScroll){
        const percentage = textarea.scrollTop / textarea.scrollHeight * 100;
        document.dispatchEvent(new CustomEvent('textarea_scroll', {detail: percentage}));
      }
    });
  }
}, 2000)

// returns a new DOM spellcheck element
function makeNewPluginElement() {
  const element = document.createElement('div');
  element.id = 'spellcheck';
  element.style.position = 'absolute';
  element.style.width = '100%';
  element.style.height = '100%';
  element.style.display = 'flex';
  element.style['flex-flow'] = 'column';
  element.style.backgroundColor = 'Red';

  const textarea = document.createElement('textarea');
  textarea.id = 'spellcheck-text';
  textarea.style.width = '100%';
  textarea.style.height = '100%';
  textarea.style.resize = 'none';
  textarea.style['margin-bottom'] = '30px';
  element.append(textarea);

  const userConsole = document.createElement('div');
  userConsole.id = 'spellcheck-console';
  userConsole.style['margin-top'] = '6px';
  userConsole.style['margin-bottom'] = '50px';
  userConsole.style.width = '100%';
  userConsole.style.height = '100px';
  userConsole.style.backgroundColor = 'rgb(249,249,249)';
  userConsole.style.overflowY = 'Scroll';
  userConsole.style.fontFamily = 'Courier New';
  userConsole.style.fontSize = '12px';
  userConsole.style.display = 'none';
  element.append(userConsole);


  textarea.addEventListener('input', (event) => {
    inputChangeEvent();
  });


  return element;
}

function inputChangeEvent() {
  const textarea = getSpellCheckTextElement();
  const newText = textarea.value;
  const temp = {a: lastFilteredText};
  const obj = JSON.stringify(temp);
  const oldText = JSON.parse(obj).a;

  if (newText === oldText) {
    return;
  }

  const newLines = newText.split('\n');
  const oldLines = oldText.split('\n');
  if (newLines.length !== oldLines.length) {
    log('Nummer of lines is not equal. Cound not apply the fix');
  } else {
    for (let i = 0; i < newLines.length; i++) {
      const newLine = newLines[i];
      const oldLine = oldLines[i];

      if (newLine !== oldLine) {
        const patches = dmp.patch_make(oldLine, newLine);

        const fixed = dmp.patch_apply(patches, lastText.split('\n')[i])[0];
        const message = JSON.stringify({method: 'replaceLine', args: {lineNumber: i, newValue: fixed}});
        document.dispatchEvent(new CustomEvent('call_command',
          {detail: message}
        ));
      }
    }
  }
}




