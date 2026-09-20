# Shared by kiosk deploy: drop a leftover .git/index.lock so reset --hard
# can proceed. A crashed git on the display host leaves this file behind
# and the next master push then fails in a few seconds.
wait_and_clear_index_lock() {
	local lock="${1:-.git/index.lock}"
	local max="${GIT_INDEX_LOCK_WAIT:-10}"
	local i
	for i in $(seq 1 "$max"); do
		if [ ! -f "$lock" ]; then
			return 0
		fi
		echo "WARN: $lock exists; waiting (${i}/${max})"
		sleep 1
	done
	if [ -f "$lock" ]; then
		echo "WARN: removing stale $lock"
		rm -f "$lock"
	fi
}
