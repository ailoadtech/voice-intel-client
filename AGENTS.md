# AGENTS.md - Voice Intelligence Client

This document provides guidance for AI coding agents working on the Voice Intelligence Client project. It explains the project structure, development workflows, coding standards, and rules that agents should follow when modifying this codebase.

## 1. Project Overview

### Purpose

Voice Intelligence is a Tauri-based desktop application for Windows that enables real-time voice recording with automatic local transcription using Whisper and optional AI-powered text enhancement through local LLM integration (Ollama or Openrouter). The application records audio from the microphone, transcribes it locally using the Whisper model, and can optionally refine the transcription using a configurable LLM prompt system.

### Main Technologies

The project uses a hybrid architecture combining web technologies for the frontend with native Rust for the backend:

- **Frontend**: Next.js 14.2.0 with React 18 and TypeScript 5.9
- **Desktop Framework**: Tauri 2.0
- **Backend Language**: Rust (latest stable)
- **Audio Processing**: Whisper (via whisper-rs), Hound library
- **HTTP Client**: Reqwest for LLM integration
- **ML Library**: @xenova/transformers for browser-mode transcription

### High-Level Architecture

The application follows a client-server architecture where the Tauri backend handles native operations while the Next.js frontend provides the user interface. The Rust backend exposes Tauri commands for audio recording, transcription, and LLM processing, which the frontend calls via the Tauri API. For browser-only mode, the application can run without Tauri using web workers and transformers.js for client-side transcription.

## 2. Repository Structure

### Directory Layout

```
voice-intel-client/
├── app/                          # Next.js frontend source
│   ├── layout.tsx               # Root layout component
│   ├── page.tsx                 # Main UI component
│   └── worker.ts                # Web Worker for browser-mode transcription
├── src-tauri/                   # Rust backend (Tauri 2.0)
│   ├── src/                     # Rust source code
│   │   ├── main.rs              # Application entry point and event loop
│   │   ├── audio.rs             # Audio recording and processing logic
│   │   ├── whisper.rs           # Whisper transcription integration
│   │   ├── llm.rs               # LLM integration (Ollama/Openrouter)
│   │   ├── config.rs            # Configuration management
│   │   └── logger.rs            # Logging system with file and console output
│   ├── capabilities/            # Tauri 2.0 capability definitions
│   │   └── default.json
│   ├── permissions/              # Tauri command permissions
│   │   └── main.json
│   ├── icons/                    # Application icons (android/, ios/)
│   ├── gen/schemas/             # Generated Tauri schemas
│   ├── Cargo.toml               # Rust dependencies
│   ├── tauri.conf.json          # Tauri application configuration
│   └── build.rs                 # Build script
├── public/                       # Static assets (images)
├── models/                      # Whisper model files (created at runtime)
├── recordings/                  # Audio recordings storage (created at runtime)
├── config.json                  # Application configuration (created at runtime)
├── package.json                  # Node.js dependencies
├── next.config.js               # Next.js configuration
├── tsconfig.json                # TypeScript configuration
└── README.md                     # Project documentation
```

### Core Logic Locations

The main business logic resides in the `src-tauri/src/` directory. Each Rust module handles a specific responsibility: `audio.rs` manages microphone recording and WAV file processing, `whisper.rs` handles transcription using the Whisper model, `llm.rs` provides integration with Ollama and Openrouter APIs, `config.rs` manages application settings, and `logger.rs` provides logging functionality. The frontend logic is contained in `app/page.tsx`, which implements the user interface.

## 3. Development Workflow

### Installing Dependencies

Before starting development, install the required dependencies:

```bash
npm install
```

This command installs all Node.js dependencies defined in package.json. For the Rust backend, Cargo will automatically fetch dependencies when building the Tauri application.

### Running the Project Locally

There are two ways to run the application depending on your needs:

**Development mode (Tauri desktop app):**

```bash
npm run tauri dev
```

This command starts the Tauri development server, which compiles the Rust backend and launches the desktop application with hot-reload support for both the Rust code and the Next.js frontend.

**Browser-only mode (without Tauri):**

```bash
npm run dev
```

This starts the Next.js development server on port 3000, enabling browser-mode features but without native desktop capabilities like global shortcuts and system tray.

### Running Tests

This project does not currently have a formal test suite. The original developer relied on manual testing through the Tauri dev server. If tests are added in the future, they should follow the testing framework conventions used in similar projects.

### Building the Project

To create a production build:

```bash
npm run build
npm run tauri build
```

The first command builds the Next.js frontend for static export, and the second compiles the Rust backend and packages everything into a Windows executable.

## 4. Coding Guidelines

### Language-Specific Conventions

The project uses two programming languages with distinct conventions:

**TypeScript/React (Frontend):**

- Use functional components with hooks
- Follow React 18 patterns with proper hook dependencies
- Use TypeScript for all new files with explicit type annotations
- Import order: external libraries, internal components, types

**Rust (Backend):**

- Follow standard Rust conventions (rustfmt)
- Use Result types for error handling
- Implement the ? operator for error propagation
- Keep functions focused and small (under 50 lines when possible)

### Formatting Rules

The project uses automatic formatting tools. Run `rustfmt` on Rust code before committing, and ensure TypeScript code follows the formatting patterns established in existing files. The Next.js project uses ESLint configuration inherited from Next.js defaults.

### Naming Conventions

- **TypeScript**: Use PascalCase for components and interfaces, camelCase for variables and functions
- **Rust**: Use snake_case for variables and functions, PascalCase for types and enums
- **Files**: Use descriptive names that reflect the module purpose (e.g., `whisper.rs` for transcription, `llm.rs` for language model integration)

### Error Handling Style

The Rust backend uses Result types extensively. All functions that can fail return `Result<T, Box<dyn Error>>` or similar error types. The frontend should handle errors gracefully by displaying user-friendly messages rather than crashing. When the LLM is unreachable, the application saves the original transcription instead of failing.

## 5. Agent Rules

### What Agents Are Allowed to Modify

Agents may modify the following files and directories:

- All source code in `app/` (TypeScript/React)
- All source code in `src-tauri/src/` (Rust)
- Configuration files: `package.json`, `next.config.js`, `tsconfig.json`
- Tauri configuration: `src-tauri/tauri.conf.json`
- Project documentation files

### What Files Should NOT Be Modified

The following files and directories should not be modified by agents:

- `.next/` directory (build artifacts)
- `node_modules/` directory (dependencies)
- `src-tauri/target/` directory (Rust build output)
- `out/` directory (production build output)
- Generated files in `src-tauri/gen/` unless explicitly required
- Credentials or configuration files containing secrets

### How Agents Should Create Commits or PRs

Agents should not create commits or pull requests without explicit user authorization. If asked to create a commit, agents should:

1. Run `git status` to see all changes
2. Run `git diff` to review modifications
3. Run `git log` to understand the commit message style
4. Create a clear, concise commit message that describes the "why" of the changes
5. Never commit files containing secrets or credentials

### How to Handle Migrations or Config Changes

When modifying configuration files or adding migrations:

- Document all changes in comments within the modified file
- For Tauri config changes, ensure they follow Tauri 2.0 schema
- For Rust dependency changes, verify compatibility with existing code
- For frontend config changes, test both in browser mode and Tauri mode

## 6. Testing Expectations

### Required Test Coverage

Currently, this project does not have automated tests. The development process relies on manual testing through the Tauri dev server. However, when adding new features or making significant changes, agents should verify:

- The application compiles without errors
- The Tauri app launches correctly
- Audio recording works as expected
- Transcription produces reasonable output
- LLM integration functions when configured

### How Tests Should Be Structured

If tests are added in the future, they should be placed in appropriate test directories or files:

- Rust: Use `#[cfg(test)]` modules within source files or `tests/` directory
- TypeScript: Use a `__tests__/` directory or colocate with `.test.ts` or `.spec.ts` extensions

### When Agents Must Add Tests

Agents must add tests when:

- Implementing new Tauri commands
- Adding new API endpoints
- Creating utility functions that could fail in edge cases
- Modifying audio processing logic

## 7. Security & Safety

### Secrets Handling

The application uses configuration files for sensitive settings. These should never be committed:

- API keys for Openrouter
- Local LLM server URLs (though localhost is generally safe)
- Any credentials in `config.json`

If adding support for new secrets, ensure they are loaded from environment variables rather than hardcoded. The `config.json` file should be in `.gitignore` and created from a template.

### Dependency Changes Policy

When adding new dependencies:

- Verify the package is actively maintained
- Check for known vulnerabilities using `npm audit`
- For Rust dependencies, check crates.io for crate quality and maintenance status
- Ensure the dependency does not introduce unnecessary bloat to the bundle
- Update package.json with the new dependency and commit the change

### Data Safety Considerations

The application processes sensitive voice data. Consider:

- All transcription happens locally by default (no cloud upload)
- Recordings are stored in a local directory that the user controls
- When integrating external services, always prioritize local processing
- Log files should not contain sensitive user data

## 8. Documentation Standards

### When Agents Should Update Docs

Agents should update documentation when:

- Adding new features that affect usage
- Changing configuration options
- Modifying the API or command signatures
- Updating dependencies or system requirements

### Required Docstrings and Comments

For Rust code, use standard Rustdoc comments for public functions:

```rust
/// Description of what the function does.
/// 
/// # Arguments
/// * `arg1` - Description of first argument
/// 
/// # Returns
/// Description of return value
/// 
/// # Errors
/// Description of possible error conditions
pub fn example_function(arg1: &str) -> Result<String, Box<dyn Error>>
```

For TypeScript code, use JSDoc comments for exported functions and complex logic:

```typescript
/**
 * Description of what the function does.
 * @param param1 - Description of parameter
 * @returns Description of return value
 */
export function exampleFunction(param1: string): string
```

Internal implementation details that are not obvious should be commented in both languages.

## 9. Example Tasks

The following examples demonstrate typical tasks an AI agent might perform in this repository:

### Example 1: Adding a New LLM Provider

To add support for a new LLM provider like Anthropic Claude:

1. Examine `src-tauri/src/llm.rs` to understand the existing Ollama/Openrouter implementation
2. Add a new function or variant to handle the new provider's API format
3. Update `config.json` documentation to include new provider options
4. Test by running `npm run tauri dev` and verifying the new provider works

### Example 2: Modifying the Frontend UI

To add a new button to the recording interface:

1. Edit `app/page.tsx` and follow the existing component patterns
2. Use the Tauri API (`@tauri-apps/api`) to invoke backend commands if needed
3. Test changes in browser mode with `npm run dev`
4. Verify in Tauri mode with `npm run tauri dev`

### Example 3: Adding a New Whisper Model Option

To add support for a different Whisper model size:

1. Modify `src-tauri/src/whisper.rs` to accept model size as a parameter
2. Update the configuration in `src-tauri/src/config.rs` to allow model selection
3. Document the new option in `README.md`
4. Test the new model by running a transcription

### Example 4: Fixing a Bug

When fixing a bug:

1. Reproduce the issue by running the application
2. Identify the relevant code through error messages or logs
3. Make the minimal necessary fix
4. Verify the fix resolves the issue
5. Document any workaround if the fix is temporary

---

For questions about this project, refer to the main README.md file or examine the source code directly.
