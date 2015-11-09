'use strict';
/* globals $, Highcharts, _, utils, EventSource */

var responseTypes = utils.responseTypes;
var requestsCountByType = utils.requestCount;

var pieChartItemLimit = 15;
var columnChartItemLimit = 10;
var lineChartItemLimit = 8;
var areaChartItemLimit = 5;

var realtimeStream;

var initialData = {
  allRouters: {},
  allInstances: {},
  allStatusCodes: {},
  routers: [ /* {
    instance: 'localhost',
    createdAt: new Date(),
    urls: [{
      url: 'GET /',
      totalResponseTime: 650,
      '200': 3
    }]
  } */ ],
  cloudApi: [
    // ...
  ]
};

var displayOptions = {
  // 路由筛选，由 filterByRouter 实现
  byRouter: null,
  // 路由状态码筛选，在 displayCharts 中实现
  byStatusCode: null,
  // 应用实例筛选，由 filterByInstance 实现
  byInstance: null
};

useCloudData();

function useCloudData() {
  $.get('lastDayStatistics.json', function(data) {
    var flattenedLogs = flattenLogs(data, initialData);

    initialData.routers = initialData.routers.concat(flattenedLogs.routers);
    initialData.cloudApi = initialData.cloudApi.concat(flattenedLogs.cloudApi);

    resetOptions();
    updateOptions();
    displayCharts();
  });
}

function useRealtimeData() {
  initialData = {
    allRouters: {},
    allInstances: {},
    allStatusCodes: {},
    routers: [],
    cloudApi: []
  };

  resetOptions();
  displayCharts();

  realtimeStream = new EventSource('realtime.json');

  realtimeStream.addEventListener('message', function(event) {
    var instanceBucket = JSON.parse(event.data);

    if (_.isEmpty(instanceBucket.routers) && _.isEmpty(instanceBucket.cloudApi))
      return;

    var flattenedLogs = flattenLogs([{
      instances: [instanceBucket],
      createdAt: new Date()
    }], initialData);

    initialData.routers = initialData.routers.concat(flattenedLogs.routers);
    initialData.cloudApi = initialData.cloudApi.concat(flattenedLogs.cloudApi);

    updateOptions();
    displayCharts();
  });

  realtimeStream.addEventListener('error', function(err) {
    console.error(err);
  });
}

function filterByRouter(logs, byRouter) {
  if (_.includes(['', null, '*'], byRouter))
    return logs;

  return _.compact(logs.map(function(log) {
    var url = _.findWhere(log.urls, {url: byRouter});

    return _.extend(log, {
      urls: url ? [url] : []
    });
  }));
}

function filterByInstance(logs, byInstance) {
  if (_.includes(['', null, '*'], byInstance))
    return logs;

  return logs.map(function(log) {
    if (log.instance == byInstance) {
      return log;
    } else {
      return _.extend(log, {
        urls: []
      });
    }
  });
}

function filterByStatusCode(logs, byStatusCode) {
  if (_.includes(['', null, '*'], byStatusCode))
    return logs;

  return logs.map(function(log) {
    return _.extend(log, {
      urls: log.urls.map(function(url) {
        return _.pick(url, function(value, key) {
          if (isFinite(parseInt(key)) && key != byStatusCode)
            return false;
          else
            return true;
        });
      })
    });
  });
}

function mergeInstances(logs) {
  var result = [];

  logs.forEach(function(log) {
    var lastLog = _.last(result);

    // 合并的条件：存在上一条记录，且上一条记录与当前记录属于不同实例，且上一条记录没有合并过当前实例的记录
    if (lastLog && lastLog.instance != log.instance && !_.includes(lastLog.mergedInstance, log.instance)) {
      utils.mergeUrlstoUrls(lastLog.urls, log.urls);

      if (lastLog.mergedInstance)
        lastLog.mergedInstance.push(log.instance);
      else
        lastLog.mergedInstance = [log.instance];
    } else {
      result.push(log);
    }
  });

  return result;
}

function flattenLogs(logs, counters) {
  var routerData = [];
  var cloudApiData = [];

  logs.forEach(function(log) {
    var createdAt = new Date(log.createdAt);

    log.instances.forEach(function(instanceBucket) {
      var instanceName = instanceBucket.instance;

      instanceBucket.routers.forEach(function (url) {
        var requests = requestsCountByStatus(url);

        incrCounter(counters.allInstances, instanceName, requests);
        incrCounter(counters.allRouters, url.url, requests);

        _.map(url, function(count, statusCode) {
          if (isFinite(parseInt(statusCode))) {
            incrCounter(counters.allStatusCodes, statusCode, count);
          }
        });
      });

      routerData.push({
        instance: instanceName,
        createdAt: createdAt,
        urls: instanceBucket.routers
      });

      cloudApiData.push({
        instance: instanceName,
        createdAt: createdAt,
        urls: instanceBucket.cloudApi
      });
    });
  });

  return {
    routers: routerData,
    cloudApi: cloudApiData
  };
}

function incrCounter(counter, field, count) {
  if (counter[field])
    counter[field] += count;
  else
    counter[field] = count;
}

function counterToSortedArray(counter) {
  return _.sortByOrder(_.map(counter, function(count, name) {
    return {
      name: name,
      count: count
    };
  }), 'count', 'desc');
}

function requestsCountByStatus(url) {
  return _.sum(_.map(url, function(value, key) {
    if (isFinite(parseInt(key)))
      return value;
    else
      return null;
  }));
}

function buildCacheOnLogs(logs) {
  logs.forEach(function (log) {
    var logRequests = 0;
    var logTotalResponseTime = 0;

    responseTypes.forEach(function(type) {
      log[type] = 0;
    });

    log.urls.forEach(function(url) {
      var urlRequests = 0;

      responseTypes.forEach(function(type) {
        url[type] = url[type] || 0;
      });

      _.map(url, function(count, key) {
        if (isFinite(parseInt(key))) {
          var responseType = utils.typeOfStatusCode(parseInt(key));
          url[responseType] += count;
          log[responseType] += count;
          urlRequests += count;
        } else if (_.includes(responseTypes, key)) {
          log[key] += count;
          urlRequests += count;
        }
      });

      url.responseTime = url.totalResponseTime / urlRequests;
      logTotalResponseTime += url.totalResponseTime;
      logRequests += urlRequests;
    });

    log.responseTime = logTotalResponseTime / logRequests;
  });
}
