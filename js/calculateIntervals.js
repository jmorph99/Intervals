

/**
 *
 * @author John Murphy
 * @email john.murphy@elastic.co
 */


/**
 * Created by murphy on 8/14/18.
 */




wildcard = /\*/;
space = /[\s]/;
fieldName = "content";
//doub = /\{[\s]*\{/g;
//doub2 = /\}[\s]*\}/g;
startexp = '{\n' +
  '  "query": {\n' +
  '    "intervals" : {\n' +
  '      "' + fieldName + '" : \n' +
  '          REPLACE ' +
  '        \n' +
  '      }\n' +
  '    }\n' +
  '  }\n';
let objectHolder;
function getResults(data){
  datal = 0;
  while(data.length !== datal){
      datal = data.length;
      data = data.replaceAll(/[\s][\s]/g," ");
  }
  
  data = data.replaceAll("NEAR","/").replaceAll(" OR "," ").replaceAll(" AND "," /1000000 ").replaceAll(" / "," /16 ").toLowerCase();
  objectHolder = new ObjectHolder();
  let ret = getQuery(fieldName, data);
  console.log(ret);
  return startexp.replace("REPLACE",ret);
}

function getQuery(fieldName, query)
{

  let code = makeQuery(fieldName, query); //query.replace("\\)\\(", ") (")
  let iq;
  try {
    iq = objectHolder.getIntervalsSourceFromCode(code);
    console.log(iq);
  }
  catch (e) {
    iq = e.message
  }
  finally {
    return iq;
  }

}

function makeQuery( fieldName, query)  {
  
  if(objectHolder.isCode(query))
    return query;
  while(true){
    let quotes = /\"[^\"(/]*\"/g;  
    let match = quotes.exec(query);
    if(match == null)
      break;
    let sub = query.substring(match.index + 1,quotes.lastIndex -1);
    let replacement = processString(fieldName, sub);
    query = query.replace(match, replacement);
  }
  while(true){
    let parenthesis = /\([^)(]*\)/g;
    let match = parenthesis.exec(query);
    if(match == null)
      break;
    let sub = query.substring(match.index + 1,parenthesis.lastIndex-1);
    let replacement = makeQuery( fieldName, sub);
    query = query.replace(query.substring(match.index,parenthesis.lastIndex),replacement);
    query = makeQuery(fieldName, query);
  }
  while(true){
    let within = /\/[0-9]*/g;
    let match = within.exec(query);
    if(match == null)
      break;
    let srange = query.substring(match.index+1, within.lastIndex);
    let range = parseInt(srange);
    let first = query.substring(0,match.index-1);
    let  second = query.substring(match.index+srange.length + 2, query.length);
    if(second.length == 0 || first.length == 0)
      alert( "Problem parsing within statement");
    let firstReplacement = makeQuery( fieldName, first);
    let secondReplacement = makeQuery( fieldName, second);
    let sqFirst = objectHolder.getIntervalsSourceFromCode(firstReplacement);
    let sqSecond = objectHolder.getIntervalsSourceFromCode(secondReplacement);
    let snq = Intervals.unordered(sqFirst, sqSecond, range);

    let code = objectHolder.addIntervalsSource(fieldName, snq);

    query = makeQuery(fieldName, code);
  }
  //String
  query = query.trim();
  let subQueries = query.split(space);
  if(subQueries.length==1){
    if (!objectHolder.isCode(query))
      query = processString( fieldName, query);
  }
  if(subQueries.length > 1){
    let codes = [];
    for(let i=0; i<subQueries.length;i++){
      if(!objectHolder.isCode(subQueries[i])){
        let ret = processString( fieldName, subQueries[i]);
        codes.push(ret);
      }
      else
        codes.push(subQueries[i])
    }
    let soq = Intervals.or(codes, objectHolder);
    let ret = objectHolder.addIntervalsSource(fieldName, soq);
    query = makeQuery( fieldName, ret);
  }
  return query;
}


function processString(fieldName, query) {

  if(objectHolder.isCode(query))
    return;

  let snq = null;
  if(!query.includes('?')  && !query.includes('*'))
    snq = Intervals.phrase(query, objectHolder)
  else
    snq = processWildCard(fieldName,query)
  let ret = objectHolder.addIntervalsSource(fieldName, snq);
  return ret;

}

function processWildCard(fieldName, query){
  let space = /[\s]/g;
  let sqs = query.split(space);
  let pure = [];
  for(let i=0;i<sqs.length;i++){
    if(!sqs[i].includes('?') && !sqs[i].includes('*') )
      pure.push(i);
  }
  let cg = null
  let combined = []
  let lastPure = true;
  for (let i=0;i<sqs.length;i++)
  {
    if (pure.includes(i))
    {
      if(cg == null)
        cg = sqs[i];
      else
        if(lastPure == true)
          cg += " " + sqs[i];
        else{

          cg = sqs[i];
        }
        lastPure = true;
    }
    else{
      lastPure = false;
      if(cg != null)
        combined.push(objectHolder.getIntervalsSourceFromCode(processString(fieldName,cg)));
      combined.push(Intervals.wildcard(sqs[i]))
    }
  }
  if(lastPure)
    combined.push(objectHolder.getIntervalsSourceFromCode(processString(fieldName,cg)));
  let ret = '{"all_of" : {"intervals" :[ \n';
  for(let i=0; i<combined.length;i++){
    if (i > 0)
      ret += ',';
    ret += combined[i];
  }

  ret += '          ],\n' +
    '          "max_gaps" : 0,\n' +
    '          "ordered" : true \n' +
    '        }}';
  return ret;


}
class ObjectHolder{
  hashmap = [];
  count = 0;
  code = "";
  addIntervalsSource(fieldName, sq, objectHolder){
    let c = this.count;
    this.code = "zz" + this.count + "zz";
    this.hashmap[this.code] =  sq;

    this.count++;
    return this.code;
  }
  getIntervalsSourceFromCode(code)
  {
    let ret = this.hashmap[code];
    return ret;
  }
  isCode(code)
  {
    return code in this.hashmap;
  }
}

class Intervals{
  static wildcard(query){
    return '{"prefix": {"pattern":"' + query.replace("*","") + '"}}';
  }
  static term(query){
    return '{"match": {"query":"' + query + '"}';
  }
  static unordered(sqFirst, sqSecond, range){
    let ret = '{"all_of" : {"intervals" :[ \n' +
      sqFirst + ',\n' +
      sqSecond + '\n' +
      '          ],\n' +
      '          "max_gaps" : ' + range + ',\n' +
      '          "ordered" : false \n' +
      '        }}';
    return ret;
  }
  static or(codes, objectHolder){
    let txtCodes = "";
    for(let i=0;i<codes.length;i++)
    {
      if (i>0)
        txtCodes += ","
      txtCodes += objectHolder.getIntervalsSourceFromCode(codes[i]) + '\n';
    }
    let ret = '{"any_of" :{ "intervals":[\n' +
      txtCodes +
      '        ]}}';
    return ret;
  }
  static phrase(query){
    let ret = '{"match" : {\n' +
      '          "query" : "' + query + '",\n' +
      '          "max_gaps" : 0,\n' +
      '          "ordered" : true\n' +
      '          }}'
    return ret;
  }

}
