1: Hardened extension core module with 16 scenarios and frozen-extension tag.
2: Enforced sidepanel modularity invariant; sidepanel modules remain strictly separate.
3: Added global error/rejection suppression in service worker to eliminate Chrome UI errors.
4: Prevented unchecked runtime.lastError via safeSendTabMessage and safeFetch Promise.race.
5: Protected content script injection against null document.body and iframe edge-cases.
