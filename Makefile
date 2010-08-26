VERSION = $(shell sed -n 's/\s*<em:version>\(.*\)<\/em:version>/\1/p' src/install.rdf)

.PHONY: all pack-chrome pack-xpi archive-xpi

all:

src/chrome/gm-notifier.jar: src/chrome/content/gm-notifier/*
	cd src/chrome; \
	rm -rf gm-notifier.jar; \
	zip -r gm-notifier.jar content locale 

pack-chrome: src/chrome/gm-notifier.jar

gm-notifier.xpi: \
		src/chrome/gm-notifier.jar \
		src/chrome.manifest \
		src/components/* \
		src/defaults/* \
		src/install.js \
		src/install.rdf \
		src/license.txt
	
	rm -rf build; \
	mkdir build; \
	mkdir build/chrome
	
	cp -r src/chrome/gm-notifier.jar build/chrome; \
	cp -r src/chrome.manifest \
		  src/components \
		  src/defaults \
		  src/install.js \
		  src/install.rdf \
		  src/license.txt \
			build
	
	# pack all in xpi
	cd build; \
	zip -r gm-notifier.xpi . ; \
	mv gm-notifier.xpi ..
	
	# clean up
	rm -rf build

pack-xpi: gm-notifier.xpi

vers/gm-notifier-$(VERSION).xpi: gm-notifier.xpi
	mkdir -p vers
	cp gm-notifier.xpi vers/gm-notifier-$(VERSION).xpi

archive-xpi: vers/gm-notifier-$(VERSION).xpi
