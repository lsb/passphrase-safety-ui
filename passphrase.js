var Passphrase = {};

Passphrase.utils = (function() {
    "use strict";
    var highEntropyTestSentence = "correct horse battery staple";
    var lowEntropyTestSentence = "Once upon a time";
    var tokenize = function(s) { return s.replace(/,/g,'').split(/(?=[-.;:\'!@#$^*()%^&+=\]\[?\"<>](?:\s+|$))|\s+/) };
    var wordListPath = "words.json";
    var wordListPathMini = "words-mini.json";
    var entropyPaths = {1: "1gcs.json", 2: "2gcs.json", 3: "3gcs.json"};
    var entropyPathsMini = {1: "1gcs.json", 2: "2gcs-mini.json", 3: "3gcs-mini.json"};
    var statsPath = function(ids) { return apiPrefix + "stats?ids=" + ids.join(','); };
    return { highEntropyTestSentence: highEntropyTestSentence, lowEntropyTestSentence: lowEntropyTestSentence, tokenize: tokenize, wordListPath: wordListPath, wordListPathMini: wordListPathMini, entropyPaths: entropyPaths, entropyPathsMini: entropyPathsMini};
})();

// all data is in terms of word ids, not words.
Passphrase.word_id_mapping = (function() {
    window.words = [];
    var loadWords = function(ws) {
	window.words = ws;
    };
    var xhrFetchK = function(isFullsize, k) { $.getJSON( (isFullsize ? Passphrase.utils.wordListPath : Passphrase.utils.wordListPathMini) , k); };
    var byId = function(id) { return window.words[id] };
    var byWord = function(word) { return window.words.indexOf(word) };
    return { loadWords: loadWords, byId: byId, byWord: byWord, xhrFetchK: xhrFetchK};
})();

// onegram entropy is stored in just an array.
// twogram-fivegram entropy is stored as a Golomb-Compressed Sequence
Passphrase.entropyCalculations = (function() {
    window.datasets = {1: null, 2: null, 3: null};
    var xhrFetchK = function(order, isFullsize, k) {
	$.getJSON( (isFullsize ? Passphrase.utils.entropyPaths : Passphrase.utils.entropyPathsMini)[order] , k)
    };
    var loadDataset = function(order, dataset) { datasets[order] = dataset; };
    var query = function(grams) {
	var d = datasets[grams.length];
	if(!d) return false;
	var found=false;
	golombFilterQueries(d.lineCount, d.modulus, d.binaryBits, d.b64EncodedGolombCodedSequence, [[grams.join(","), function() { found = true }, function() {}]], d.partialSumBitcounts);
	return found;
    };
    var batchQueryK = function(gramKKs) {}; // TODO
    return {xhrFetchK: xhrFetchK, loadDataset: loadDataset, query: query};
})();


// we want to take a passphrase in, and mark all the problem words.
Passphrase.dataAnalysis = (function() {
    "use strict";
    var getMaxFailingOrders = function(tokens) {
	[1,2,3,4,5].forEach(function(order) {
		tokens.forEach(function(t, index) {
			if(index < order-1) return;
			if(t.get("maxFailingOrder")) return;
			var ngram = tokens.slice(index-order+1, index+1);
			var lacksId = ngram.filter(function(g) { return !g.hasId() }).length > 0;
			if(lacksId) return;
			if(Passphrase.entropyCalculations.query(ngram.map(function(g) { return g.id() }))) t.set({maxFailingOrder: order, context: ngram.slice(0,-1).map(function(g) { return g.get("word") })});
		    });
	    });
    };
    return {getMaxFailingOrders: getMaxFailingOrders};
})();
Passphrase.display = (function() {
	var Token = Backbone.Model.extend({
		hasId: function() { return this.id() > 0; },
		id: function() { return Passphrase.word_id_mapping.byWord(this.get("word")) },
		isLowEntropy: function() { return !!this.get("maxFailingOrder") },
		context: function() { return this.get("context") },
		zeroToThree: function() {
		    return this.hasId() ? (this.isLowEntropy() ? (this.get("maxFailingOrder") == 1 ? 0 : 1) : 2) : 3;
		},
	    });
	var TokenView = Backbone.View.extend({
		template: _.template("<%= word %>"),
		zT3: {3: _.template("The word <<%= word %>> wasn't found in the dictionary."),
		      2: _.template("The word <<%= word %>> is an uncommon word."),
		      0: _.template("The word <<%= word %>> is a fairly common word."),
		      1: _.template("The word <<%= word %>> is predictable from the phrase <<%= context.join('><') %>>.")
		},
		events: {"click": "displayReasoning"},
		render: function() {
		    var m = this.model;
		    this.$el.html(this.template(m.toJSON()));
		    this.$el.attr("class", "entropy" + m.zeroToThree());
		    return this.$el;
		},
		displayReasoning: function() {
		    alert(this.zT3[this.model.zeroToThree()](this.model.toJSON()));
		},
		initialize: function() {
		    this.model.on("change", this.render, this);
		}
	    });
	var SimpleRender = Backbone.View.extend({
		render: function() {
		    var passphrase = this.model.get("passphrase");
		    var tokens = Passphrase.utils.tokenize(passphrase);
		    var tokenModels = tokens.map(function(t) { return new Passphrase.display.Token({word: t, maxFailingOrder: null, context: [t]}) });
		    var tokenViews = tokenModels.map(function(tM) { return new Passphrase.display.TokenView({model: tM}); });
		    var vis = this.model.get("vis");
		    vis.html("");
		    tokenViews.forEach(function(tV) { tV.render(); vis.append(tV.$el); });
		    Passphrase.dataAnalysis.getMaxFailingOrders(tokenModels);
		    return tokenViews;
		}
	    });
	var App = SimpleRender.extend({
		initialize: function() {
		    var eC = Passphrase.entropyCalculations;
		    var xFK = eC.xhrFetchK;
		    var lD = eC.loadDataset;
		    Passphrase.word_id_mapping.xhrFetchK(false, function(d) {
			    Passphrase.word_id_mapping.loadWords(d);
			    xFK(1, false, function(g1) {
				    lD(1,g1);
				    xFK(2, false, function(g2) {
					    lD(2,g2);
					    (new Passphrase.display.SimpleRender({model: new Backbone.Model({passphrase: "Once upon a time", vis: $("#lo-entropy-demo")})})).render();
					    (new Passphrase.display.SimpleRender({model: new Backbone.Model({passphrase: "correct horse battery staple", vis: $("#hi-entropy-demo") })})).render();
					    Passphrase.word_id_mapping.xhrFetchK(true, Passphrase.word_id_mapping.loadWords);
					    xFK(3, true, function(g3) { lD(3,g3) });
					    xFK(1, true, function(largeG1) { lD(1, largeG1) });
					    xFK(2, true, function(largeG2) { lD(2, largeG2) });
					});
				});
			});
		    this.model.set("tokens", []);
		    this.model.set("vis", $("#vis", this.$el));
		},
		el: $("#app"),
		events: {"click button": "readPage"},
		readPage: function() {
		    this.model.get("tokens").forEach(function(t) { t.remove() });
		    this.model.set("passphrase", $("#passphrase-input", this.$el).val());
		    this.model.set("tokens", this.render());
		}
	    });

	return {Token: Token, TokenView: TokenView, App: App, SimpleRender: SimpleRender};
})();
		    
		    