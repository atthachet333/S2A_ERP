import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true}}componentDidCatch(error:Error,info:ErrorInfo){console.error('UI boundary',error.message,info.componentStack)}render(){if(this.state.failed)return <main className="error-boundary"><AlertTriangle/><h1>เกิดข้อผิดพลาดในการแสดงหน้านี้</h1><p>ข้อมูลของคุณยังปลอดภัย ลองโหลดหน้านี้ใหม่หรือกลับหน้าหลัก</p><div><button onClick={()=>{this.setState({failed:false});window.location.reload()}}><RefreshCw/>ลองใหม่</button><a href="/dashboard"><Home/>กลับหน้าหลัก</a></div></main>;return this.props.children}}
