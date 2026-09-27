PYTHON ?= python3

.PHONY: help intake hero motion-plan motion-qc preflight record-publish bootstrap list-topics

help:
	@printf '%s\n' 'FBM Reel Studio commands:' \
	  '  make intake TOPIC="..." DURATION=auto EP=EPISODE-ID [TIP="..."]' \
	  '  make hero EP=EPISODE-ID [CONCEPT="auto"]' \
	  '  make motion-plan EP=EPISODE-ID [OVERWRITE=1]' \
	  '  make motion-qc EP=EPISODE-ID' \
	  '  make preflight EP=EPISODE-ID [STAGE=planning|script|release]' \
	  '  make record-publish EP=EPISODE-ID' \
	  '  make bootstrap' \
	  '  make list-topics'

intake:
	@test -n "$(TOPIC)" || (echo 'TOPIC is required' && exit 2)
	$(PYTHON) tools/ops/intake.py --topic "$(TOPIC)" --duration "$(or $(DURATION),auto)" --tip "$(TIP)" --episode "$(EP)"

hero:
	@test -n "$(EP)" || (echo 'EP is required' && exit 2)
	$(PYTHON) tools/ops/hero_open.py episodes/$(EP) --concept "$(or $(CONCEPT),auto)"

motion-plan:
	@test -n "$(EP)" || (echo 'EP is required' && exit 2)
	$(PYTHON) tools/engine/motion_manifest.py episodes/$(EP) plan $(if $(OVERWRITE),--overwrite,)

motion-qc:
	@test -n "$(EP)" || (echo 'EP is required' && exit 2)
	$(PYTHON) tools/engine/motion_manifest.py episodes/$(EP) validate --strict
	$(PYTHON) tools/engine/motion_qc.py episodes/$(EP)

preflight:
	@test -n "$(EP)" || (echo 'EP is required' && exit 2)
	$(PYTHON) tools/ops/preflight.py episodes/$(EP) --stage "$(or $(STAGE),release)"

record-publish:
	@test -n "$(EP)" || (echo 'EP is required' && exit 2)
	$(PYTHON) tools/ops/record_publish.py episodes/$(EP)

bootstrap:
	zsh tools/engine/bootstrap_env.sh

list-topics:
	$(PYTHON) tools/engine/new_episode.py --list
