#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PHASES=()
PHASE_NAMES=(
	"" "Security" "Pure Logic" "Service Contract" "Agent Loop" "Memory System"
	"MCP System" "IPC Channel" "Key Manager" "Diff Application" "Configuration"
	"Tool Registry" "Project Session" "Error Recovery" "Notification/Telemetry"
	"UI Views" "Build/CI" "Performance" "E2E" "Accessibility/i18n"
)

PHASE_FILES=(
	"" "security/security" "unit/pureLogic" "service/serviceContract" "agent/agentLoop" "memory/memorySystem"
	"mcp/mcpSystem" "ipc/ipcChannel" "keymanager/secureKeyManager" "diff/diffApplication" "config/configuration"
	"tools/toolRegistry" "project/projectSession" "recovery/errorRecovery" "notification/notificationTelemetryPlugin"
	"ui/uiViews" "build/buildCi" "performance/perfStress" "e2e/crossPlatformE2e" "accessibility/accessibilityI18n"
)

if [ $# -eq 0 ]; then
	PHASES=(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19)
elif [ "$1" = "quick" ]; then
	PHASES=(1 2)
elif [ "$1" = "all" ]; then
	PHASES=(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19)
else
	for arg in "$@"; do
		PHASES+=("$arg")
	done
fi

TOTAL_PASSED=0
TOTAL_FAILED=0

for PHASE in "${PHASES[@]}"; do
	PHASE_NAME="${PHASE_NAMES[$PHASE]}"
	FILE="${PHASE_FILES[$PHASE]}"
	TEST_PATH="test/unit/construct/${FILE}.test.ts"

	echo -e "\n${BLUE}Phase $PHASE: $PHASE_NAME${NC}"

	if [ ! -f "$TEST_PATH" ]; then
		echo -e "  ${YELLOW}SKIP: File not found${NC}"
		continue
	fi

	if npx mocha --ui tdd --timeout 10000 --require ts-node/register "$TEST_PATH" 2>&1; then
		echo -e "  ${GREEN}PASS${NC}"
		TOTAL_PASSED=$((TOTAL_PASSED + 1))
	else
		echo -e "  ${RED}FAIL${NC}"
		TOTAL_FAILED=$((TOTAL_FAILED + 1))
	fi
done

echo -e "\n${GREEN}Passed: $TOTAL_PASSED${NC} ${RED}Failed: $TOTAL_FAILED${NC}"

if [ "$TOTAL_FAILED" -gt 0 ]; then
	exit 1
fi
