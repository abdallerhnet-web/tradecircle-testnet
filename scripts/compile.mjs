import solc from 'solc';
import fs from 'node:fs';
const src = fs.readFileSync('contracts/TradeCircleRegistry.sol', 'utf8');
const input = { language: 'Solidity', sources: { 'TradeCircleRegistry.sol': { content: src } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter(e => e.severity === 'error');
(out.errors || []).forEach(e => console.log(e.formattedMessage));
if (errs.length) { console.error('COMPILE FAILED'); process.exit(1); }
const c = out.contracts['TradeCircleRegistry.sol'].TradeCircleRegistry;
fs.writeFileSync('src/artifact.json', JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }));
console.log('compiled ok, bytecode bytes:', c.evm.bytecode.object.length / 2);
