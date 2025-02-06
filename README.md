# Git Cleanup CLI Tool

A Node.js CLI tool to help clean up your local Git branches that have no active upstream branch or whose upstream branch is gone. This script assists in removing stale local branches while protecting your default branch (e.g., `main` or `master`).

> **WARNING** Branches deleted locally cannot be recovered. If you have any local unsaved work that has not been pushed to a remote repository, **IT WILL BE LOST**. Use this tool at your own risk. The maintainers assume no responsibility for any data loss. Always review the branches marked for deletion before confirming the cleanup process.

## Features

- **Detects Stale Branches:**  
  Identifies branches that either have no upstream branch or have an upstream branch marked as `gone` (for example, after a PR is merged and the remote branch is deleted).

- **Default Branch Detection:**  
  Checks for the existence of local `main` and/or `master` branches. If both exist, you will be prompted to select which one you use as your default.

- **Pre-Cleanup Check:**  
  Before performing any cleanup, if you are not currently on your default branch, you’ll be asked whether you’d like to switch to it or have your current branch excluded from cleanup.

- **Safe and Forced Deletion Options:**  
  - **Safe deletion:** Uses `git branch -d` and warns if a branch is not fully merged.  
  - **Forced deletion:** Uses `git branch -D` to remove branches that couldn’t be safely deleted.

- **Flexible Cleanup Choices:**  
  Choose to delete all stale branches, force-delete them, or delete all except your default branch.

## Installation

This CLI tool is published on NPM and can be run directly using NPX. Make sure you have [Node.js](https://nodejs.org/) installed.

## Usage

Run the following command from the root of any Git repository (i.e., a folder containing a `.git` directory):

```bash
npx git-branch-cleanup
