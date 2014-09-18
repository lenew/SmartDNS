var config;
var dgram = require('dgram');
//var bu = require('./lib/BufferUtils');
var packet = require('native-dns-packet');
var server = dgram.createSocket('udp4');
var net = require('net');
var async = require('async');
var HOST;
var PORT;
var DNS;
var fakeIpList;

exports.startup = function(configFile) {

    if(!configFile) {
        config = require('./config.json');
    } else {
        config = configFile;
    }
    HOST = config.listen.host;
    PORT = config.listen.port;
    DNS = config.dns;
    fakeIpList = config.fakeIpList;


    server.bind(PORT, HOST);
    server.on('listening', function () {
        var address = server.address();
        console.log('-------------------------------------------');
        console.log('DNS Server listening on ' + address.address + ":" + address.port);
        console.log('-------------------------------------------');
    });

    server.on('message', function (message, remote) {
        queryDNSs(message, function(data){
            server.send(data, 0, data.length, remote.port, remote.address, function (err, bytes) {

            });
        });
    });
};

function getDomain(buffer) {
    var question = packet.parse(buffer).question;
    return question[0].name;
}

function ip2long(ip){
    var components;

    if(components = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/))
    {
        var iplong = 0;
        var power  = 1;
        for(var i=4; i>=1; i-=1)
        {
            iplong += power * parseInt(components[i]);
            power  *= 256;
        }
        return iplong;
    }
    else return -1;
}

function inSubNet(ip, subnet)
{   
    var mask, base_ip, long_ip = ip2long(ip);
    if( (mask = subnet.match(/^(.*?)\/(\d{1,2})$/)) && ((base_ip=ip2long(mask[1])) >= 0) )
    {
        var freedom = Math.pow(2, 32 - parseInt(mask[2]));
        return (long_ip > base_ip) && (long_ip < base_ip + freedom - 1);
    }
    else return false;
}

function isFakeIp(ip, list) {
    if(ip.length == 0) {
        return true;
    }
    for(var i in list) {
        if(ip[0] == list[i]) {
            return true;
        }
        if(inSubNet(ip[0], list[i])) {
            return true;
        }
    }
    return false;
}

function getIpAddress(buffer) {
    var ipList  = [];
    var answer = packet.parse(buffer).answer;
    answer.forEach(function(ans){
        if(ans.address) {
            ipList.push(ans.address);
        }
    });
    return ipList;
}

function queryDNSs(message, cb) {
    var dataCallback;
    async.detectSeries(DNS, function (item, callback) {
        if(item.type == 'UDP' || (!item.type)) {
            queryDNSwithUDP(message, item.ip, (item.port ? item.port : 53), function (data) {
                if(data) {
                        dataCallback = data;
                        callback(true);
                } else {
                        callback(false);
                }
            });
        } else if (item.type == 'TCP') {
            queryDNSwithTCP(message, item.ip, (item.port ? item.port : 53), function (data) {
                if(data) {
                        dataCallback = data;
                        callback(true);
                } else {
                        callback(false);
                }
            });
        }
    }, function (results) {
        if(!results) {
            console.log("Error in request..");
            console.log("-------------------------------------------");
            return;
        }
        var now = new Date();
        console.log(now.toLocaleDateString() + ' ' + now.toLocaleTimeString());
        console.log('Res from ' + results.ip + ' ' + (results.type ? results.type : 'UDP'));
        console.log(getDomain(dataCallback) + ' ->');
        getIpAddress(dataCallback).forEach(function(ip) {
            console.log('    ' + ip);
        });
        console.log('-------------------------------------------');
        cb(dataCallback);
    });
}

function queryDNSwithUDP(message, address, port, cb) {
    var client = dgram.createSocket('udp4');
    async.series({
            send: function (callback) {
                client.send(message, 0, message.length, port, address, function (err, bytes) {
                });
                callback(null);
            },
            receive: function (callback) {
                client.on("message", function (message, remote) {
                    if(!isFakeIp(getIpAddress(message), fakeIpList)) {
                        callback(null, message);
                    } else {
                        callback(null, null);
                    }
                });
                client.on("error", function (err) {
                    callback(null, null);
                });
            }
        }, function (err, results) {
            client.close();
            if(results) {
                cb(results.receive);
            }
        }
    );
}

function queryDNSwithTCP(message, address, port, cb) {
    var client = new net.Socket();
    var messageTcp = new Buffer(message.length + 2);
    messageTcp[0] = message.length / 256;
    messageTcp[1] = message.length % 256;
    message.copy(messageTcp, 2, 0, messageTcp.length);
    client.connect(port, address, function() {
        client.write(messageTcp);
    });
    client.on('data', function (dataTcp) {
        var length = parseInt(dataTcp[1].toString(10) + dataTcp[0].toString(10) * 256);
        var data = new Buffer(length);
        dataTcp.copy(data, 0, 2, length + 2);
        cb(data);
    });
    client.on('error', function (err) {
        cb(null);
    });
}

function queryDNSwithProxy(message) {
}
