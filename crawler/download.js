var Mongo = require('./db'),
    models = Mongo.models,
    utils = require('./utils'),
    Q = require('q'),
    _ = require('lodash'),
    colors = require('colors'),
    http = require('http'),
    parser = require('./parser.js'),
    jsdom = require('jsdom'),
    jquery = require('jquery'),
    iconv = require('iconv-lite');

var baseUrl = 'http://cnes.datasus.gov.br/';
var self = {
    doGet: function(url) {
        var deferred = Q.defer();
        http.get(url, function(res) {
            var data = '';
            res.setEncoding('binary');
            res.on('data', function(chunk) {
                return data += chunk;
            });
            res.on('end', function() {
                var utf8String = iconv.decode(new Buffer(data), 'UTF-8');
                jsdom.env(utf8String, function(errors, htmlDoc) {
                    var $ = jquery(htmlDoc);
                    deferred.resolve($, url);
                });
            });
            res.on('error', function(err) {
                deferred.reject(err);
            });
        });
        return deferred.promise;
    },
    downloadAndParse: function(parserFunction, url) {
        var deferred = Q.defer();
        self.doGet(url).then(function(html) {
            var result = parserFunction(html, url);
            deferred.resolve(result);
        }).catch(function(err) {
            deferred.reject(err);
        });
        return deferred.promise;
    },
    downloadStates: function(url) {
        var deferred = Q.defer();
        console.log('Baixando estados: ', url);
        self.downloadAndParse(parser.parseStates, url).then(function(states) {
            deferred.resolve(states);
        }).catch(function(err) {
            console.log(err);
            deferred.reject(err);
        });
        return deferred.promise;
    },
    downloadCities: function(url) {
        var deferred = Q.defer();
        console.log('Baixando Cidades: ', url);
        self.downloadAndParse(parser.parseCities, url).then(function(cities) {
            deferred.resolve(cities);
        }).catch(function(err) {
            console.log(err);
            deferred.reject(err);
        });
        return deferred.promise;
    },
    downloadEntitiesUrls: function(url) {
        var deferred = Q.defer();
        console.log('Baixando Entidades da cidade: ', url);
        self.downloadAndParse(parser.getEntitiesUrlsFromCity, url).then(function(entitiesUrls) {
            deferred.resolve(entitiesUrls);
        }).catch(function(err) {
            console.log(err);
            deferred.reject(err);
        });
        return deferred.promise;
    },
    downloadEntity: function(url) {
        var deferred = Q.defer();
        self.downloadAndParse(parser.parseEntityData, url).then(function(entity) {
            deferred.resolve(entity);
        }).catch(function(err) {
            console.log(err);
            deferred.reject(err);
        });
        return deferred.promise;
    },
    processStates: function() {
        var statesUrl = baseUrl + 'Lista_Tot_Es_Estado.asp';
        self.downloadStates(statesUrl).then(function(states) {
            Mongo.save(states, models.State);
            var statesLength = states.length;
            utils.forSync(states, function(state, done) {
                if (!state.done) {
                    self.downloadCities(state.value.url).then(function(cities) {
                        self.processCities(cities, done);
                    });
                }
            });
        });
    },
    processCities: function(cities, statesDone) {
        utils.forSync(cities, function(city, done) {
            if (!city.done) {
                var cityUrl = city.value.url;
                var searchJson = {
                    url: cityUrl
                };
                Mongo.findOne(searchJson, models.City).then(function(exists) {
                    if (!exists) {
                        self.downloadEntitiesUrls(cityUrl).then(function(entitiesUrls) {
                            self.processEntitiesUrl(entitiesUrls);
                            Mongo.save(city.value, models.City);
                            done();
                        });
                    } else {
                        done();
                    }
                });
            } else {
                return statesDone();
            }
        });
    },
    processEntitiesUrl: function(entitiesUrls) {
        Mongo.save(entitiesUrls, models.EntityUrl);
    },
    processEntities: function() {
        Mongo.paginateDatabaseAsStream(models.EntityUrl, function(entityToDownload, done) {
            self.downloadEntity(entityToDownload.url).then(function(entity) {
                Mongo.save(entity, models.Entity);
                var idJson = {
                    _id: entityToDownload._id
                }
                Mongo.delete(idJson, models.EntityUrl);
                done();
            });
        });
    }
};

module.exports = self;
