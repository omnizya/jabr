"""Code Review Workflow using Jabr Agents.

This workflow demonstrates how to orchestrate a code review process
using multiple Jabr agents (explorer, librarian, fixer, oracle).
"""

from typing import Any

import mistralai.workflows as workflows
from pydantic import BaseModel

from .jabr.connector import JabrConnector, JabrConfig
from .jabr.models import JabrTask


class CodeReviewInput(BaseModel):
    """Input for code review workflow."""
    code: str
    language: str = "python"
    repository_url: str = ""
    file_path: str = ""
    review_focus: str = "security,performance,style"


class CodeReviewOutput(BaseModel):
    """Output from code review workflow."""
    issues: list[dict[str, Any]] = []
    suggestions: list[dict[str, Any]] = []
    score: dict[str, float] = {}
    summary: str = ""


@workflows.activity()
async def analyze_with_oracle(
    code: str,
    language: str,
    focus: str,
) -> dict[str, Any]:
    """Use the oracle agent for general analysis."""
    connector = JabrConnector(JabrConfig(timeout_seconds=60))
    task = JabrTask(
        text=f"Analyze this {language} code for {focus}. Provide a detailed analysis.",
        agent="oracle",
        context={"code": code, "language": language, "focus": focus},
    )
    result = await connector.send_task(task)
    return result.dict()


@workflows.activity()
async def explore_dependencies(
    code: str,
    language: str,
) -> dict[str, Any]:
    """Use the explorer agent to find dependencies and imports."""
    connector = JabrConnector(JabrConfig(timeout_seconds=60))
    task = JabrTask(
        text=f"Analyze dependencies and imports in this {language} code.",
        agent="explorer",
        context={"code": code, "language": language},
    )
    result = await connector.send_task(task)
    return result.dict()


@workflows.activity()
async def check_with_librarian(
    code: str,
    language: str,
) -> dict[str, Any]:
    """Use the librarian agent for pattern and best practice checking."""
    connector = JabrConnector(JabrConfig(timeout_seconds=60))
    task = JabrTask(
        text=f"Check this {language} code against best practices and patterns.",
        agent="librarian",
        context={"code": code, "language": language},
    )
    result = await connector.send_task(task)
    return result.dict()


@workflows.activity()
async def suggest_fixes(
    code: str,
    issues: list[str],
    language: str,
) -> dict[str, Any]:
    """Use the fixer agent to suggest fixes for identified issues."""
    connector = JabrConnector(JabrConfig(timeout_seconds=60))
    task = JabrTask(
        text=f"Suggest fixes for these issues in the {language} code:",
        agent="fixer",
        context={"code": code, "issues": issues, "language": language},
    )
    result = await connector.send_task(task)
    return result.dict()


@workflows.workflow.define(
    name="jabr-code-review",
    workflow_display_name="Jabr Code Review",
    workflow_description="Perform comprehensive code review using Jabr agents",
)
class JabrCodeReviewWorkflow:
    @workflows.workflow.entrypoint
    async def run(self, input: CodeReviewInput) -> CodeReviewOutput:
        """Orchestrate a comprehensive code review.

        This workflow:
        1. Uses explorer to analyze dependencies
        2. Uses librarian to check best practices
        3. Uses oracle for general analysis
        4. Uses fixer to suggest improvements
        5. Aggregates all findings into a comprehensive review
        """
        workflows.logger.info(f"Starting code review for {input.language} code")

        # Step 1: Analyze dependencies
        workflows.logger.info("Step 1: Analyzing dependencies...")
        dep_analysis = await explore_dependencies(
            code=input.code,
            language=input.language,
        )
        workflows.logger.info(f"Dependencies analysis: {dep_analysis.get('status')}")

        # Step 2: Check best practices
        workflows.logger.info("Step 2: Checking best practices...")
        best_practices = await check_with_librarian(
            code=input.code,
            language=input.language,
        )
        workflows.logger.info(f"Best practices check: {best_practices.get('status')}")

        # Step 3: General analysis
        workflows.logger.info("Step 3: General analysis...")
        oracle_analysis = await analyze_with_oracle(
            code=input.code,
            language=input.language,
            focus=input.review_focus,
        )
        workflows.logger.info(f"Oracle analysis: {oracle_analysis.get('status')}")

        # Collect issues from all analyses
        issues: list[dict[str, Any]] = []
        suggestions: list[dict[str, Any]] = []

        for analysis in [dep_analysis, best_practices, oracle_analysis]:
            if analysis.get("status") == "COMPLETED":
                text = analysis.get("text", "")
                data = analysis.get("data", {})

                # Parse issues from text (simple parsing)
                if "issues" in text.lower() or "problems" in text.lower():
                    issues.append({
                        "source": analysis.get("agent", "unknown"),
                        "text": text,
                        "data": data,
                    })

                # Parse suggestions
                if "suggestion" in text.lower() or "recommend" in text.lower():
                    suggestions.append({
                        "source": analysis.get("agent", "unknown"),
                        "text": text,
                        "data": data,
                    })

        # Step 4: Get fix suggestions if we have issues
        if issues:
            workflows.logger.info("Step 4: Getting fix suggestions...")
            issue_texts = [i.get("text", "")[:200] for i in issues[:5]]  # Limit to 5 issues
            fix_suggestions = await suggest_fixes(
                code=input.code,
                issues=issue_texts,
                language=input.language,
            )
            if fix_suggestions.get("status") == "COMPLETED":
                suggestions.append({
                    "source": "fixer",
                    "text": fix_suggestions.get("text", ""),
                    "data": fix_suggestions.get("data", {}),
                })

        # Calculate scores based on analysis results
        scores = {
            "quality": 8.0,
            "security": 8.0,
            "performance": 8.0,
            "maintainability": 8.0,
        }

        # Adjust scores based on findings
        if issues:
            for issue in issues:
                text = issue.get("text", "").lower()
                if "security" in text:
                    scores["security"] -= 1.5
                if "performance" in text or "slow" in text:
                    scores["performance"] -= 1.5
                if "maintain" in text or "complex" in text:
                    scores["maintainability"] -= 1.5
                if "quality" in text or "bug" in text:
                    scores["quality"] -= 1.5

        # Ensure scores are within bounds
        for key in scores:
            scores[key] = max(0, min(10, scores[key]))

        # Generate summary
        summary_parts = [
            f"Code Review for {input.language} code ({len(input.code)} chars)",
            f"Issues found: {len(issues)}",
            f"Suggestions: {len(suggestions)}",
            f"Average score: {sum(scores.values()) / len(scores):.2f}/10",
        ]

        if input.repository_url:
            summary_parts.append(f"Repository: {input.repository_url}")
        if input.file_path:
            summary_parts.append(f"File: {input.file_path}")

        return CodeReviewOutput(
            issues=issues,
            suggestions=suggestions,
            score=scores,
            summary=" | ".join(summary_parts),
        )


@workflows.workflow.define(
    name="jabr-quick-review",
    workflow_display_name="Jabr Quick Review",
    workflow_description="Quick code review using only the oracle agent",
)
class JabrQuickReviewWorkflow:
    @workflows.workflow.entrypoint
    async def run(self, input: CodeReviewInput) -> CodeReviewOutput:
        """Quick code review using just the oracle agent."""
        workflows.logger.info(f"Quick review for {input.language} code")

        # Use oracle for quick analysis
        analysis = await analyze_with_oracle(
            code=input.code,
            language=input.language,
            focus=input.review_focus,
        )

        issues = []
        suggestions = []
        scores = {
            "quality": 7.5,
            "security": 7.5,
            "performance": 7.5,
            "maintainability": 7.5,
        }

        if analysis.get("status") == "COMPLETED":
            text = analysis.get("text", "")
            data = analysis.get("data", {})

            # Simple parsing of the oracle response
            if "issues" in text.lower() or "problems" in text.lower():
                issues.append({"source": "oracle", "text": text, "data": data})

            if "suggestion" in text.lower() or "recommend" in text.lower():
                suggestions.append({"source": "oracle", "text": text, "data": data})

            # Adjust score based on text analysis
            if "excellent" in text.lower() or "great" in text.lower():
                for key in scores:
                    scores[key] += 1.0
            elif "good" in text.lower():
                for key in scores:
                    scores[key] += 0.5
            elif "poor" in text.lower() or "bad" in text.lower():
                for key in scores:
                    scores[key] -= 1.5

            # Ensure scores are within bounds
            for key in scores:
                scores[key] = max(0, min(10, scores[key]))

        summary = f"Quick Review: {len(text) if text else 0} chars analyzed, Score: {sum(scores.values()) / len(scores):.2f}/10"

        return CodeReviewOutput(
            issues=issues,
            suggestions=suggestions,
            score=scores,
            summary=summary,
        )
