# Security Policy

## Supported Versions

We actively maintain the latest minor release line of **Kites**. Security patches and critical bug fixes are released on the latest version.

| Version | Supported          | Notes                                     |
| ------- | ------------------ | ----------------------------------------- |
| 1.3.x   | :white_check_mark: | Current active release line               |
| 1.2.x   | :x:                | Superseded — please upgrade to 1.3.x      |
| < 1.2.0 | :x:                | Unsupported                               |

---

## Reporting a Vulnerability

If you discover a security vulnerability or sensitive bug in Kites (including extension privilege boundaries, host permissions, cross-origin messaging, or backend worker proxy logic), please report it responsibly:

### How to Report

1. **GitHub Private Vulnerability Report (Preferred):**  
   Use GitHub's built-in private reporting feature:  
   👉 [Report a security vulnerability](https://github.com/Unheat/Kites/security/advisories/new)

2. **Direct Email:**  
   If you cannot use GitHub Advisories, email **anbi2682006@gmail.com** with the subject `[SECURITY] Kites Vulnerability Report`.

> **Note:** Please **do not** open public issues, discussions, or pull requests for security vulnerabilities until they have been reviewed and resolved.

---

## What to Include in Your Report

To help us investigate and patch the issue quickly, please include:
- **Component:** Chrome extension client (content script, background service worker, offscreen canvas) or Cloudflare Worker backend.
- **Affected Version:** Exact Kites version and browser/environment (e.g. Chrome 130 on macOS).
- **Description:** A concise explanation of the vulnerability and expected impact.
- **Steps to Reproduce:** Step-by-step instructions, minimal reproduction URL, or sample proof of concept.

---

## Response & Disclosure Process

- **Acknowledgement:** We aim to acknowledge new vulnerability reports within **48 to 72 hours**.
- **Investigation:** We will verify the issue, assess severity, and keep you informed of the mitigation plan.
- **Resolution:** A fix will be developed, tested, and shipped in a new release.
- **Credit:** We are happy to credit security researchers in release notes if desired.
